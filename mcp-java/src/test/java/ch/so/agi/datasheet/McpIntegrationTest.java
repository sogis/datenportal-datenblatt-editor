package ch.so.agi.datasheet;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("http")
class McpIntegrationTest {
    @LocalServerPort int port;
    private String rawSessionId;
    private String rawProtocolVersion;
    private McpSyncClient connect() {
        return McpClient.sync(HttpClientStreamableHttpTransport.builder("http://127.0.0.1:" + port + "/mcp").build()).build();
    }
    @SuppressWarnings("unchecked")
    private static Map<String, Object> payload(CallToolResult result) {
        return (Map<String, Object>) result.structuredContent();
    }
    private static CallToolResult call(McpSyncClient client, String name, Map<String, Object> args) {
        return client.callTool(CallToolRequest.builder(name).arguments(args).build());
    }
    @Test void contractsAndCompleteWorkflow() throws Exception {
        try (var client = connect()) {
            assertThat(client.initialize().serverInfo().version()).isEqualTo("0.2.0");
            var tools = client.listTools().tools();
            assertThat(tools.stream().map(Tool::name)).containsExactlyInAnyOrder(
                    "describe_schema", "create_datasheet", "import_xtf", "read_datasheet",
                    "update_metadata", "upsert_attribute", "remove_attribute", "upsert_issue",
                    "remove_issue", "validate_datasheet", "export_xtf", "discard_datasheet");
            assertThat(tools).allSatisfy(tool -> {
                assertThat(tool.inputSchema()).containsEntry("additionalProperties", false);
                assertThat(tool.annotations().openWorldHint()).isFalse();
            });
            assertThat(tools.stream().filter(t -> t.name().equals("update_metadata")).findFirst().orElseThrow()
                    .annotations().readOnlyHint()).isFalse();
            var schema = payload(call(client, "describe_schema", Map.of("kind", "attribute")));
            assertThat(schema).containsKey("attribute");
            var imported = call(client, "import_xtf", Map.of("xml", DatasheetServiceTest.fixture("dataset")));
            assertThat(imported.isError()).isFalse();
            assertThat(((TextContent) imported.content().getFirst()).text()).contains("draft_id");
            String id = (String) payload(imported).get("draft_id");
            var changed = call(client, "upsert_attribute", Map.of("draft_id", id, "expected_revision", 1,
                    "values", Map.of("name", "FOO", "data_type", "Text", "description", "Flächenmass in Quadratmeter", "mandatory", false)));
            assertThat(changed.isError()).isFalse();
            assertThat(((Number) payload(changed).get("revision")).intValue()).isEqualTo(2);
            var validation = call(client, "validate_datasheet", Map.of("draft_id", id, "expected_revision", 2));
            assertThat(payload(validation)).containsEntry("valid", true);
            var exported = call(client, "export_xtf", Map.of("draft_id", id, "expected_revision", 2, "include_xml", true));
            assertThat(exported.isError()).isFalse();
            assertThat(payload(exported).get("xml").toString()).contains("DatasetAttribute", "Flächenmass");
            var conflict = call(client, "update_metadata", Map.of("draft_id", id, "expected_revision", 1, "values", Map.of("title", "stale")));
            assertThat(conflict.isError()).isTrue();
            assertThat(payload(conflict)).containsEntry("code", "revision_conflict");
            assertThat(call(client, "discard_datasheet", Map.of("draft_id", id, "expected_revision", 2)).isError()).isFalse();
            assertThat(call(client, "read_datasheet", Map.of("draft_id", id)).isError()).isTrue();
        }
    }
    @Test void keyedImportAndDownloadOverHttp() throws Exception {
        try (var client = connect()) {
            client.initialize();
            var first = payload(call(client, "import_xtf", Map.of("xml", DatasheetServiceTest.fixture("dataset"), "import_key", "http-key")));
            String id = first.get("draft_id").toString();
            call(client, "update_metadata", Map.of("draft_id", id, "expected_revision", 1, "values", Map.of("title", "HTTP test")));
            var reused = payload(call(client, "import_xtf", Map.of("xml", DatasheetServiceTest.fixture("dataset"), "import_key", "http-key")));
            assertThat(reused).containsEntry("reused", true).containsEntry("draft_id", id);
            var exported = payload(call(client, "export_xtf", Map.of("draft_id", id, "expected_revision", 2)));
            assertThat(exported).containsKeys("download_url", "expires_at").doesNotContainKey("xml");
            String path = java.net.URI.create(exported.get("download_url").toString()).getPath();
            var http = java.net.http.HttpClient.newHttpClient();
            var response = http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:" + port + path)).build(),
                    java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.headers().firstValue("Content-Type").orElseThrow()).contains("application/xml", "UTF-8");
            assertThat(response.headers().firstValue("Content-Disposition").orElseThrow()).contains("attachment", ".xtf");
            assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).isEqualTo("no-store");
            var explicit = payload(call(client, "export_xtf", Map.of("draft_id", id, "expected_revision", 2, "include_xml", true)));
            assertThat(response.body()).isEqualTo(explicit.get("xml").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            call(client, "discard_datasheet", Map.of("draft_id", id, "expected_revision", 2));
            var again = http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:" + port + path)).build(),
                    java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            assertThat(again.body()).isEqualTo(response.body());
            assertThat(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:" + port + "/api/exports/missing")).build(),
                    java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(404);
        }
    }

    @Test void rawHttpPreservesNullPatchesAndExactRevisionNumbers() throws Exception {
        try (var client = connect()) {
            client.initialize();
            var created = payload(call(client, "create_datasheet",
                    Map.of("kind", "dataset", "values", Map.of("title", "Clear me"))));
            String id = created.get("draft_id").toString();
            String prefix = "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{"
                    + "\"name\":\"update_metadata\",\"arguments\":{\"draft_id\":\"" + id + "\",";
            var rejected = rawCall(prefix + "\"expected_revision\":1.0000000000000000001,\"values\":{\"title\":null}}}}");
            assertThat(rejected.get("isError")).isEqualTo(true);
            var cleared = rawCall(prefix + "\"expected_revision\":1,\"values\":{\"title\":null}}}}");
            assertThat(cleared.get("isError")).isEqualTo(false);
            var content = DatasheetServiceTest.obj(cleared.get("structuredContent"));
            assertThat(DatasheetServiceTest.obj(content.get("data"))).doesNotContainKey("title");
            var changes = DatasheetServiceTest.list(content.get("changes"));
            assertThat(changes.getFirst()).containsEntry("before", "Clear me").containsEntry("after", null);
        }
    }
    @SuppressWarnings("unchecked")
    private Map<String, Object> rawCall(String body) throws Exception {
        if (rawSessionId == null) {
            var initialized = java.net.http.HttpClient.newHttpClient().send(rawRequest()
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString("""
                        {"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                          "protocolVersion":"2025-11-25","capabilities":{},
                          "clientInfo":{"name":"raw-http-test","version":"1.0"}}}
                        """)).build(), java.net.http.HttpResponse.BodyHandlers.ofString());
            assertThat(initialized.statusCode()).isEqualTo(200);
            rawSessionId = initialized.headers().firstValue("Mcp-Session-Id").orElseThrow();
            rawProtocolVersion = rawResult(initialized.body()).get("protocolVersion").toString();
            var notification = java.net.http.HttpClient.newHttpClient().send(rawRequest()
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}")).build(),
                    java.net.http.HttpResponse.BodyHandlers.discarding());
            assertThat(notification.statusCode()).isEqualTo(202);
        }
        var request = rawRequest()
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build();
        var response = java.net.http.HttpClient.newHttpClient().send(request, java.net.http.HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return rawResult(response.body());
    }
    private java.net.http.HttpRequest.Builder rawRequest() {
        var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:" + port + "/mcp"))
                .timeout(java.time.Duration.ofSeconds(30))
                .header("Content-Type", "application/json").header("Accept", "application/json, text/event-stream");
        if (rawSessionId != null) request.header("Mcp-Session-Id", rawSessionId)
                .header("MCP-Protocol-Version", rawProtocolVersion);
        return request;
    }
    @SuppressWarnings("unchecked")
    private Map<String, Object> rawResult(String body) {
        String json = body.strip();
        if (!json.startsWith("{")) json = json.lines().filter(line -> line.startsWith("data:"))
                .map(line -> line.substring(5).strip()).findFirst().orElseThrow();
        return (Map<String, Object>) new tools.jackson.databind.json.JsonMapper().readValue(json, Map.class).get("result");
    }
    @AfterEach void closeRawSession() throws Exception {
        if (rawSessionId != null) {
            var response = java.net.http.HttpClient.newHttpClient().send(rawRequest().DELETE().build(),
                    java.net.http.HttpResponse.BodyHandlers.discarding());
            assertThat(response.statusCode()).isEqualTo(200);
        }
    }

    @Test void seriesExportAndReimportOverHttp() throws Exception {
        try (var client = connect()) {
            client.initialize();
            var imported = payload(call(client, "import_xtf", Map.of("xml", DatasheetServiceTest.fixture("series"))));
            var exported = payload(call(client, "export_xtf", Map.of("draft_id", imported.get("draft_id"),
                    "expected_revision", 1, "include_xml", true)));
            assertThat(exported).containsKeys("download_url", "expires_at", "xml");
            var reimported = payload(call(client, "import_xtf", Map.of("xml", exported.get("xml"))));
            assertThat(reimported).containsEntry("kind", "series");
            assertThat(payload(call(client, "validate_datasheet", Map.of("draft_id", reimported.get("draft_id"),
                    "expected_revision", 1)))).containsEntry("valid", true);
        }
    }

    @Test void invalidArgumentsAndValidationFailuresHaveDistinctResults() {
        try (var client = connect()) {
            client.initialize();
            var created = call(client, "create_datasheet", Map.of("kind", "dataset"));
            String id = (String) payload(created).get("draft_id");
            for (var args : List.of(
                    Map.<String, Object>of("draft_id", id, "expected_revision", 1.5, "values", Map.of("title", "x")),
                    Map.<String, Object>of("draft_id", id, "expected_revision", 1, "values", Map.of("unknown", "x")),
                    Map.<String, Object>of("draft_id", id, "expected_revision", 1, "values", Map.of("title", 42)),
                    Map.<String, Object>of("draft_id", id, "expected_revision", 1, "values", Map.of(), "surprise", true))) {
                var result = call(client, "update_metadata", args);
                assertThat(result.isError()).isTrue();
                assertThat(result.content()).isNotEmpty(); // SDK may reject the schema before invoking our handler.
            }
            var validation = call(client, "validate_datasheet", Map.of("draft_id", id, "expected_revision", 1));
            assertThat(validation.isError()).isFalse();
            assertThat(payload(validation)).containsEntry("valid", false);
            var export = call(client, "export_xtf", Map.of("draft_id", id, "expected_revision", 1));
            assertThat(export.isError()).isTrue();
            assertThat(payload(export)).containsEntry("code", "validation_failed");
        }
    }
}
