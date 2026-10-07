package ch.so.agi.datasheet.mcp;

import ch.so.agi.datasheet.model.FieldCatalog;
import ch.so.agi.datasheet.service.*;
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema.*;
import org.springframework.context.annotation.*;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.util.*;
import java.util.function.Function;

@Configuration
public class McpServerTools {
    private final DatasheetService service;
    private final ObjectMapper mapper;
    private final boolean http;
    public McpServerTools(DatasheetService service, ObjectMapper mapper, Optional<ExportStore> exports) {
        this.service = service; this.mapper = mapper; this.http = exports.isPresent();
    }

    @Bean
    public List<SyncToolSpecification> mcpToolSpecifications() {
        return List.of(
            tool("describe_schema", "Feldregeln des Datenblattmodells. Pflichtwerte dürfen im Entwurf fehlen.",
                args("kind", Map.of("type", "string", "enum", List.of("dataset", "series", "issue", "attribute", "contact", "temporal"))),
                List.of(), true, a -> FieldCatalog.describe(optional(a, "kind"))),
            tool("create_datasheet", "Dataset oder Serie im Speicher anlegen. Anfangswerte sind optional; keine erfundenen Pflichtwerte.",
                args("kind", Map.of("type", "string", "enum", List.of("dataset", "series")), "values", metadataSchema()),
                List.of("kind"), false, a -> service.create(text(a, "kind"), values(a, false))),
            tool("import_xtf", "XTF 2.4 importieren. import_key verwendet einen bestehenden Entwurf wieder. "
                    + (http ? "Für Open-WebUI-Chat-Anhänge import_xtf_attachment verwenden."
                            : "Der Client liest die Originaldatei und übergibt deren XML."),
                args("xml", string(), "import_key", string()), List.of("xml"), false,
                a -> service.importXtf(text(a, "xml"), optional(a, "import_key"))),
            tool("read_datasheet", "Entwurf samt Revision und internen Attribut-/Ausgabe-IDs lesen.",
                args("draft_id", string()), List.of("draft_id"), true, a -> service.read(text(a, "draft_id"))),
            tool("update_metadata", "Nur übergebene Metadaten ändern. Null entfernt Werte; Kontakt wird feldweise geändert. issue_id adressiert eine Ausgabe.",
                editing(true, "values", metadataSchema()), List.of("draft_id", "expected_revision", "values"), false,
                a -> service.update(text(a, "draft_id"), revision(a), optional(a, "issue_id"), values(a, true))),
            tool("upsert_attribute", "Attribut über attribute_id, sonst exakten Namen finden; bei keinem Namenstreffer anlegen. Mehrere Treffer sind ein Fehler.",
                editing(true, "attribute_id", string(), "values", objectSchema(FieldCatalog.properties("attribute", false))),
                List.of("draft_id", "expected_revision", "values"), false,
                a -> service.upsertAttribute(text(a, "draft_id"), revision(a), optional(a, "issue_id"), optional(a, "attribute_id"), values(a, true))),
            tool("remove_attribute", "Ein Attribut über seine interne ID aus dem Entwurf entfernen.",
                editing(true, "attribute_id", string()), List.of("draft_id", "expected_revision", "attribute_id"), false,
                a -> service.removeAttribute(text(a, "draft_id"), revision(a), optional(a, "issue_id"), text(a, "attribute_id"))),
            tool("upsert_issue", "Serienausgabe über issue_id, sonst identifier finden und ändern oder anlegen. Keine automatische Vererbung.",
                editing(true, "values", objectSchema(FieldCatalog.properties("issue", true))),
                List.of("draft_id", "expected_revision", "values"), false,
                a -> service.upsertIssue(text(a, "draft_id"), revision(a), optional(a, "issue_id"), values(a, true))),
            tool("remove_issue", "Eine Serienausgabe über ihre interne ID entfernen.",
                editing(true), List.of("draft_id", "expected_revision", "issue_id"), false,
                a -> service.removeIssue(text(a, "draft_id"), revision(a), text(a, "issue_id"))),
            tool("validate_datasheet", "Gewünschte Revision mit ilivalidator 1.15.0 prüfen; liefert valid und Meldungen.",
                editing(false), List.of("draft_id", "expected_revision"), true,
                a -> service.validate(text(a, "draft_id"), revision(a))),
            tool("export_xtf", "Gewünschte Revision als XTF 2.4 erzeugen und dieselben Bytes validieren. "
                    + (http ? "Liefert einen Download-Link für eine Stunde. Diesen unverändert als Markdown-Link anzeigen. XML nur mit include_xml=true."
                            : "include_xml=true ist erforderlich. Liefert XML und file_name; der Client speichert das XML unverändert als UTF-8. Kein Download-Link."),
                editing(false, "include_xml", Map.of("type", "boolean", "default", false)),
                List.of("draft_id", "expected_revision"), true,
                a -> service.export(text(a, "draft_id"), revision(a), bool(a, "include_xml"))),
            tool("discard_datasheet", "Entwurf endgültig aus dem flüchtigen Speicher entfernen.",
                editing(false), List.of("draft_id", "expected_revision"), false,
                a -> service.discard(text(a, "draft_id"), revision(a)))
        );
    }
    private SyncToolSpecification tool(String name, String description, Map<String, Object> properties,
                                        List<String> required, boolean readOnly,
                                        Function<Map<String, Object>, Map<String, Object>> handler) {
        Map<String, Object> schema = new LinkedHashMap<>(objectSchema(properties));
        schema.put("required", required);
        return SyncToolSpecification.builder()
                .tool(Tool.builder().name(name).description(description).inputSchema(schema)
                        .annotations(new ToolAnnotations(name, readOnly, !readOnly,
                                readOnly, false, null)).build())
                .callHandler((context, request) -> {
                    try {
                        Map<String, Object> arguments = request.arguments() == null ? Map.of() : request.arguments();
                        for (String key : arguments.keySet())
                            if (!properties.containsKey(key)) throw new ToolError("invalid_arguments", "Unbekanntes Argument: " + key);
                        for (String key : required)
                            if (!arguments.containsKey(key) || arguments.get(key) == null)
                                throw new ToolError("invalid_arguments", "Argument fehlt: " + key);
                        // Optional envelope arguments may be omitted, but not null.
                        for (String key : arguments.keySet())
                            if (arguments.get(key) == null) throw new ToolError("invalid_arguments", "Argument darf nicht null sein: " + key);
                        return result(handler.apply(arguments), false);
                    } catch (ToolError error) {
                        Map<String, Object> data = new LinkedHashMap<>(error.details);
                        data.put("code", error.code); data.put("message", error.getMessage());
                        return result(data, true);
                    } catch (Exception error) {
                        org.slf4j.LoggerFactory.getLogger(getClass()).error("MCP tool failed: {}", name, error);
                        return result(Map.of("code", "internal_error", "message", "Technischer Fehler bei " + name), true);
                    }
                }).build();
    }
    private CallToolResult result(Map<String, Object> data, boolean error) {
        return CallToolResult.builder(List.of(TextContent.builder(mapper.writeValueAsString(data)).build()))
                .structuredContent(data).isError(error).build();
    }
    private static Map<String, Object> metadataSchema() {
        Map<String, Object> fields = new LinkedHashMap<>(FieldCatalog.properties("dataset", true));
        fields.putAll(FieldCatalog.properties("issue", true));
        return objectSchema(fields);
    }
    private static Map<String, Object> editing(boolean issue, Object... extra) {
        Map<String, Object> fields = args("draft_id", string(), "expected_revision", Map.of("type", "integer", "minimum", 1));
        if (issue) fields.put("issue_id", string());
        fields.putAll(args(extra));
        return fields;
    }
    private static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return Map.of("type", "object", "properties", properties, "additionalProperties", false);
    }
    private static Map<String, Object> string() { return Map.of("type", "string", "minLength", 1); }
    private static Map<String, Object> args(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }
    private static String text(Map<String, Object> args, String key) {
        if (!(args.get(key) instanceof String value) || value.isBlank())
            throw new ToolError("invalid_arguments", "Text erforderlich: " + key);
        return value;
    }
    private static String optional(Map<String, Object> args, String key) { return args.containsKey(key) ? text(args, key) : null; }
    private static boolean bool(Map<String, Object> args, String key) {
        if (!args.containsKey(key)) return false;
        if (!(args.get(key) instanceof Boolean value)) throw new ToolError("invalid_arguments", "Boolean erforderlich: " + key);
        return value;
    }
    private static long revision(Map<String, Object> args) {
        if (!(args.get("expected_revision") instanceof Number number))
            throw new ToolError("invalid_arguments", "expected_revision muss eine positive Ganzzahl sein.");
        try {
            long value = new BigDecimal(number.toString()).longValueExact();
            if (value < 1) throw new ArithmeticException();
            return value;
        } catch (ArithmeticException | NumberFormatException e) {
            throw new ToolError("invalid_arguments", "expected_revision muss eine positive Ganzzahl sein.");
        }
    }
    private static Map<String, Object> values(Map<String, Object> args, boolean required) {
        return !required && !args.containsKey("values") ? Map.of() : FieldCatalog.object(args.get("values"));
    }
}
