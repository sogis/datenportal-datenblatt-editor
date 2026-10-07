package ch.so.agi.datasheet;

import java.io.*;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/** Exercises the actual packaged process, without a client hiding stdout noise. */
class StdioE2eTest {
    @Test void datasetAndSeriesWorkflowsUseValidatedXmlWithoutDownloadLinks() throws Exception {
        try (var server = new Server()) {
            var initialized = server.initialize();
            assertThat(obj(initialized.get("serverInfo"))).containsEntry("version", "0.2.0");
            assertThat(initialized.get("instructions").toString()).contains("include_xml=true", "UTF-8");
            var tools = (List<?>) server.request("tools/list", Map.of()).get("tools");
            assertThat(tools.stream().map(t -> obj(t).get("name"))).containsExactlyInAnyOrder(
                    "describe_schema", "create_datasheet", "import_xtf", "read_datasheet", "update_metadata",
                    "upsert_attribute", "remove_attribute", "upsert_issue", "remove_issue",
                    "validate_datasheet", "export_xtf", "discard_datasheet");
            for (String kind : List.of("dataset", "series")) {
                String fixture = Files.readString(Path.of("src/test/resources/" + kind + ".xtf"));
                var imported = server.tool("import_xtf", Map.of("xml", fixture, "import_key", kind));
                String id = imported.get("draft_id").toString();
                server.tool("upsert_attribute", Map.of("draft_id", id, "expected_revision", 1, "values",
                        Map.of("name", "FOO", "data_type", "Text", "description", "Flächenmass in Quadratmeter", "mandatory", false)));
                assertThat(server.tool("import_xtf", Map.of("xml", fixture, "import_key", kind)))
                        .containsEntry("draft_id", id).containsEntry("revision", 2).containsEntry("reused", true);
                assertThat(server.tool("validate_datasheet", Map.of("draft_id", id, "expected_revision", 2)))
                        .containsEntry("valid", true);
                for (var arguments : List.of(Map.of("draft_id", id, "expected_revision", 2),
                        Map.of("draft_id", id, "expected_revision", 2, "include_xml", false))) {
                    var rejected = server.toolResult("export_xtf", arguments);
                    assertThat(rejected).containsEntry("isError", true);
                    assertThat(obj(rejected.get("structuredContent"))).containsEntry("code", "invalid_arguments");
                    assertThat(obj(rejected.get("structuredContent")).get("message").toString()).contains("include_xml=true");
                }
                var exported = server.tool("export_xtf", Map.of("draft_id", id, "expected_revision", 2, "include_xml", true));
                assertThat(exported).containsKeys("draft_id", "revision", "file_name", "messages", "xml")
                        .doesNotContainKeys("download_url", "expires_at");
                String xml = exported.get("xml").toString();
                assertThat(xml).contains("FOO", "Flächenmass");
                var again = server.tool("import_xtf", Map.of("xml", xml));
                assertThat(again).containsEntry("kind", kind);
                assertThat(server.tool("validate_datasheet", Map.of("draft_id", again.get("draft_id"), "expected_revision", 1)))
                        .containsEntry("valid", true);
                server.tool("discard_datasheet", Map.of("draft_id", id, "expected_revision", 2));
                assertThat(server.toolResult("read_datasheet", Map.of("draft_id", id))).containsEntry("isError", true);
            }
            server.eof();
        }
    }

    @Test void nullPatchesExactNumbersAndValidationFailuresSurviveStdio() throws Exception {
        // STDIO must start even if its configured HTTP port is already occupied.
        try (var occupied = new ServerSocket(0);
             var server = new Server("--spring.profiles.active=stdio", "--server.port=" + occupied.getLocalPort())) {
            server.initialize();
            var created = server.tool("create_datasheet", Map.of("kind", "dataset", "values", Map.of("title", "Clear me")));
            String id = created.get("draft_id").toString();
            String prefix = "{\"jsonrpc\":\"2.0\",\"id\":900,\"method\":\"tools/call\",\"params\":{"
                    + "\"name\":\"update_metadata\",\"arguments\":{\"draft_id\":\"" + id + "\",";
            server.write(prefix + "\"expected_revision\":1.0000000000000000001,\"values\":{\"title\":null}}}}");
            assertThat(server.reply(900)).containsEntry("isError", true);
            var values = new HashMap<String, Object>(); values.put("title", null);
            var cleared = server.tool("update_metadata", Map.of("draft_id", id, "expected_revision", 1, "values", values));
            assertThat(obj(cleared.get("data"))).doesNotContainKey("title");
            assertThat(obj(((List<?>) cleared.get("changes")).getFirst())).containsEntry("after", null);
            var conflict = server.toolResult("update_metadata", Map.of("draft_id", id, "expected_revision", 1,
                    "values", Map.of("title", "stale")));
            assertThat(obj(conflict.get("structuredContent"))).containsEntry("code", "revision_conflict");
            assertThat(server.tool("validate_datasheet", Map.of("draft_id", id, "expected_revision", 2)))
                    .containsEntry("valid", false);
            var invalid = server.toolResult("export_xtf", Map.of("draft_id", id, "expected_revision", 2, "include_xml", true));
            assertThat(invalid).containsEntry("isError", true);
            assertThat(obj(invalid.get("structuredContent"))).containsEntry("code", "validation_failed");
            server.eof();
        }
    }

    @Test void largeAndConcurrentResponsesDrainBeforeCleanEof() throws Exception {
        try (var server = new Server()) {
            server.initialize();
            var created = server.tool("create_datasheet", Map.of("kind", "dataset"));
            String id = created.get("draft_id").toString();
            server.tool("upsert_attribute", Map.of("draft_id", id, "expected_revision", 1, "values",
                    Map.of("name", "LARGE", "description", "ä".repeat(90_000))));
            List<Integer> requests = new ArrayList<>();
            for (int i = 0; i < 24; i++) {
                requests.add(server.send("tools/call", Map.of("name", "read_datasheet", "arguments", Map.of("draft_id", id))));
                requests.add(server.send("tools/list", Map.of()));
            }
            for (int request : requests) assertThat(server.reply(request)).isNotEmpty();
            assertThat(server.largestLine).isGreaterThan(64 * 1024);
            server.eof();
        }
    }

    @Test void immediateEofAlsoStopsTheProcess() throws Exception {
        try (var server = new Server()) { server.eof(); }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> obj(Object value) { return (Map<String, Object>) value; }

    static final class Server implements AutoCloseable {
        final JsonMapper mapper = new JsonMapper();
        final Process process;
        final BufferedWriter input;
        final BlockingQueue<Map<String, Object>> output = new LinkedBlockingQueue<>();
        final Map<Integer, Map<String, Object>> pending = new HashMap<>();
        final AtomicReference<Throwable> readerFailure = new AtomicReference<>();
        final List<String> stderr = new CopyOnWriteArrayList<>();
        final Thread stdoutPump, stderrPump;
        int nextId = 1;
        volatile int largestLine;

        Server(String... arguments) throws Exception {
            var command = new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                    "-jar", "build/libs/datasheet-mcp.jar", "--logging.level.root=INFO"));
            command.addAll(List.of(arguments));
            var builder = new ProcessBuilder(command);
            builder.environment().remove("SPRING_PROFILES_ACTIVE");
            builder.environment().remove("SPRING_PROFILES_DEFAULT");
            // No HTTP URL validation or download store should be required by the STDIO context.
            builder.environment().put("DATASHEET_PUBLIC_BASE_URL", "not-an-http-url");
            process = builder.start();
            input = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
            stdoutPump = Thread.ofPlatform().daemon().start(() -> {
                try (var reader = process.inputReader(StandardCharsets.UTF_8)) {
                    for (String line; (line = reader.readLine()) != null;) {
                        largestLine = Math.max(largestLine, line.getBytes(StandardCharsets.UTF_8).length);
                        var message = obj(mapper.readValue(line, Map.class));
                        assertThat(message).containsEntry("jsonrpc", "2.0");
                        output.add(message);
                    }
                } catch (Throwable e) { readerFailure.set(e); }
            });
            stderrPump = Thread.ofPlatform().daemon().start(() -> {
                try (var reader = process.errorReader(StandardCharsets.UTF_8)) {
                    for (String line; (line = reader.readLine()) != null;) stderr.add(line);
                } catch (IOException e) { readerFailure.compareAndSet(null, e); }
            });
        }
        Map<String, Object> initialize() throws Exception {
            var result = request("initialize", Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "stdio-e2e", "version", "1.0")));
            write(mapper.writeValueAsString(Map.of("jsonrpc", "2.0", "method", "notifications/initialized")));
            return result;
        }
        void write(String json) throws IOException { input.write(json); input.newLine(); input.flush(); }
        int send(String method, Map<String, ?> params) throws Exception {
            int id = nextId++;
            write(mapper.writeValueAsString(Map.of("jsonrpc", "2.0", "id", id, "method", method, "params", params)));
            return id;
        }
        Map<String, Object> request(String method, Map<String, ?> params) throws Exception { return reply(send(method, params)); }
        Map<String, Object> toolResult(String name, Map<String, ?> arguments) throws Exception {
            return request("tools/call", Map.of("name", name, "arguments", arguments));
        }
        Map<String, Object> tool(String name, Map<String, ?> arguments) throws Exception {
            var result = toolResult(name, arguments);
            assertThat(result.get("isError")).as(result.toString()).isEqualTo(false);
            return obj(result.get("structuredContent"));
        }
        Map<String, Object> reply(int id) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40);
            while (!pending.containsKey(id) && System.nanoTime() < deadline) {
                assertThat(readerFailure.get()).as(String.join("\n", stderr)).isNull();
                var message = output.poll(100, TimeUnit.MILLISECONDS);
                if (message != null && message.get("id") instanceof Number n) pending.put(n.intValue(), message);
            }
            var message = pending.remove(id);
            assertThat(message).as("response %s; stderr: %s", id, stderr).isNotNull();
            assertThat(message).doesNotContainKey("error");
            return obj(message.get("result"));
        }
        void eof() throws Exception {
            input.close();
            assertThat(process.waitFor(15, TimeUnit.SECONDS)).as(String.join("\n", stderr)).isTrue();
            stdoutPump.join(2000); stderrPump.join(2000);
            assertThat(process.exitValue()).as(String.join("\n", stderr)).isZero();
            assertThat(readerFailure.get()).isNull();
            assertThat(String.join("\n", stderr)).doesNotContain("Failed to enqueue", "onErrorDropped", "Tomcat");
        }
        public void close() throws Exception {
            input.close();
            if (process.isAlive()) {
                process.destroy();
                if (!process.waitFor(5, TimeUnit.SECONDS)) process.destroyForcibly();
            }
        }
    }
}
