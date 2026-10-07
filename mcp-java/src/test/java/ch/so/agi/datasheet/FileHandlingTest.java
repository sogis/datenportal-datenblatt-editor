package ch.so.agi.datasheet;

import ch.so.agi.datasheet.service.*;
import ch.so.agi.datasheet.interlis.InterlisService;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;
import static ch.so.agi.datasheet.DatasheetServiceTest.*;

class FileHandlingTest {
    static InterlisService interlis;
    static class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-09-11T12:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
    MutableClock clock;
    ExportStore exports;
    DatasheetService service;
    @BeforeAll static void start() throws Exception { interlis = new InterlisService(); }
    @AfterAll static void stop() { interlis.close(); }
    @BeforeEach void setup() {
        clock = new MutableClock(); exports = new ExportStore(clock, "https://downloads.example/prefix/");
        service = new DatasheetService(interlis, Optional.of(exports));
    }
    static String token(Map<String, Object> result) {
        String url = result.get("download_url").toString(); return url.substring(url.lastIndexOf('/') + 1);
    }
    @Test void repeatImportKeepsEditsAndRevisionAndDetectsContentMismatch() throws Exception {
        String xml = fixture("dataset");
        var first = service.importXtf(xml, "key");
        service.update(id(first), 1, null, Map.of("title", "Edited"));
        var reused = service.importXtf(xml, "key");
        assertThat(reused).containsEntry("reused", true).containsEntry("draft_id", id(first)).containsEntry("revision", 2L);
        assertThat(data(reused)).containsEntry("title", "Edited");
        assertThatThrownBy(() -> service.importXtf(xml + "\n", "key"))
                .isInstanceOfSatisfying(ToolError.class, e -> assertThat(e.code).isEqualTo("import_conflict"));
        service.discard(id(first), 2);
        assertThat(service.importXtf(xml, "key")).containsEntry("reused", false).doesNotContainEntry("draft_id", id(first));
        assertThat(service.importXtf(xml)).doesNotContainEntry("draft_id", id(first)).containsEntry("reused", false);
    }
    @Test void failedImportDoesNotReserveKeyAndFreshServiceHasNoMapping() throws Exception {
        assertThatThrownBy(() -> service.importXtf("<broken>", "key")).isInstanceOf(ToolError.class);
        var first = service.importXtf(fixture("dataset"), "key");
        var restarted = new DatasheetService(interlis, Optional.of(exports));
        assertThat(restarted.importXtf(fixture("dataset"), "key")).doesNotContainEntry("draft_id", id(first));
    }
    @Test void concurrentImportsCreateOneDraft() throws Exception {
        String xml = fixture("dataset");
        try (var pool = Executors.newFixedThreadPool(8)) {
            CountDownLatch gate = new CountDownLatch(1);
            List<Future<Map<String, Object>>> calls = new ArrayList<>();
            for (int i = 0; i < 8; i++) calls.add(pool.submit(() -> { gate.await(); return service.importXtf(xml, "key"); }));
            gate.countDown();
            List<Map<String, Object>> results = new ArrayList<>();
            for (var call : calls) results.add(call.get(30, TimeUnit.SECONDS));
            assertThat(results.stream().map(DatasheetServiceTest::id).distinct()).hasSize(1);
            assertThat(results).filteredOn(r -> Boolean.FALSE.equals(r.get("reused"))).hasSize(1);
        }
    }
    @Test void exportIsImmutableExpiresAfterOneHourAndSurvivesDiscard() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        var result = service.export(id(draft), 1, false);
        assertThat(result).doesNotContainKey("xml").containsEntry("revision", 1L)
                .containsEntry("expires_at", "2026-09-11T13:00:00Z");
        assertThat(result.get("download_url").toString()).startsWith("https://downloads.example/prefix/api/exports/");
        byte[] bytes = exports.get(token(result)).orElseThrow().bytes();
        service.update(id(draft), 1, null, Map.of("title", "Changed after export"));
        service.discard(id(draft), 2);
        assertThat(exports.get(token(result)).orElseThrow().bytes()).isEqualTo(bytes);
        byte[] outside = exports.get(token(result)).orElseThrow().bytes(); outside[0] = 0;
        assertThat(exports.get(token(result)).orElseThrow().bytes()).isEqualTo(bytes);
        assertThat(interlis.validate(new String(bytes, java.nio.charset.StandardCharsets.UTF_8)).valid()).isTrue();
        clock.now = clock.now.plusSeconds(3599);
        assertThat(exports.get(token(result))).isPresent();
        clock.now = clock.now.plusSeconds(1);
        assertThat(exports.get(token(result))).isEmpty();
        assertThat(exports.get("unknown")).isEmpty();
    }
    @Test void cleanupAndParallelReadsKeepUnexpiredBytesIntact() throws Exception {
        var old = exports.put(new byte[]{1, 2}, "old.xtf");
        clock.now = clock.now.plusSeconds(3600);
        var fresh = exports.put(new byte[]{3, 4}, "fresh.xtf");
        String oldToken = old.url().substring(old.url().lastIndexOf('/') + 1);
        String freshToken = fresh.url().substring(fresh.url().lastIndexOf('/') + 1);
        try (var pool = Executors.newFixedThreadPool(4)) {
            List<Callable<Void>> work = new ArrayList<>();
            for (int i = 0; i < 20; i++) work.add(() -> {
                exports.removeExpired();
                assertThat(exports.get(oldToken)).isEmpty();
                assertThat(exports.get(freshToken).orElseThrow().bytes()).containsExactly((byte) 3, (byte) 4);
                return null;
            });
            for (var result : pool.invokeAll(work)) result.get();
        }
    }
}
