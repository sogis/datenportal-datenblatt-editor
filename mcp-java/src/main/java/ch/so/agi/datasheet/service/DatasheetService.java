package ch.so.agi.datasheet.service;

import ch.so.agi.datasheet.model.*;
import ch.so.agi.datasheet.interlis.InterlisService;
import ch.so.agi.datasheet.interlis.InterlisService.Transfer;
import org.springframework.stereotype.Service;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

@Service
public class DatasheetService {
    private static final class Draft {
        final String id = UUID.randomUUID().toString();
        final String basketId, objectId;
        Node root;
        long revision = 1;
        boolean discarded;
        Draft(Transfer transfer) {
            root = transfer.root().copy(); basketId = transfer.basketId(); objectId = transfer.objectId();
        }
    }
    private record Snapshot(String id, long revision, Transfer transfer) {
        Map<String, Object> json() {
            return Map.of("draft_id", id, "revision", revision, "kind", transfer.root().kind,
                    "basket_id", transfer.basketId(), "object_id", transfer.objectId(),
                    "data", transfer.root().json());
        }
    }
    private final ConcurrentHashMap<String, Draft> drafts = new ConcurrentHashMap<>();
    private record Imported(String checksum, String draftId) {}
    // Lock order is imports -> draft. Ordinary edits only acquire a draft lock.
    private final Map<String, Imported> imports = new HashMap<>();
    private final InterlisService interlis;
    private final Optional<ExportStore> exports;
    public DatasheetService(InterlisService interlis, Optional<ExportStore> exports) {
        this.interlis = interlis; this.exports = exports;
    }

    public Map<String, Object> create(String kind, Map<String, Object> values) {
        if (!Set.of("dataset", "series").contains(kind)) throw new ToolError("invalid_arguments", "kind muss dataset oder series sein.");
        Node root = new Node(kind);
        FieldCatalog.patch(root, values, true);
        return store(new Transfer(root, UUID.randomUUID().toString(), UUID.randomUUID().toString()));
    }
    public Map<String, Object> importXtf(String xml) { return importXtf(xml, null); }
    public Map<String, Object> importXtf(String xml, String importKey) {
        if (importKey == null) return importedResult(store(interlis.read(xml)), false);
        if (importKey.isBlank()) throw new ToolError("invalid_arguments", "import_key darf nicht leer sein.");
        String checksum = checksum(xml);
        synchronized (imports) {
            Imported previous = imports.get(importKey);
            if (previous != null) {
                if (!previous.checksum().equals(checksum))
                    throw new ToolError("import_conflict", "Importschlüssel wurde mit anderem Inhalt verwendet.");
                return importedResult(read(previous.draftId()), true);
            }
            Map<String, Object> created = store(interlis.read(xml));
            imports.put(importKey, new Imported(checksum, (String) created.get("draft_id")));
            return importedResult(created, false);
        }
    }
    private static Map<String, Object> importedResult(Map<String, Object> draft, boolean reused) {
        var result = new LinkedHashMap<>(draft); result.put("reused", reused); return result;
    }
    private static String checksum(String xml) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(xml.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private Map<String, Object> store(Transfer transfer) {
        Draft draft = new Draft(transfer); drafts.put(draft.id, draft);
        return snapshot(draft.id, null).json();
    }
    public Map<String, Object> read(String id) { return snapshot(id, null).json(); }

    public Map<String, Object> update(String id, long revision, String issueId, Map<String, Object> values) {
        return mutate(id, revision, root -> FieldCatalog.patch(target(root, issueId), values, true));
    }
    public Map<String, Object> upsertAttribute(String id, long revision, String issueId, String attributeId,
                                               Map<String, Object> values) {
        return mutate(id, revision, root -> {
            List<Node> attributes = target(root, issueId).children("attributes");
            Node attribute = findForUpsert(attributes, attributeId, values.get("name"), "name");
            if (attribute == null) { attribute = new Node("attribute"); attributes.add(attribute); }
            FieldCatalog.patch(attribute, values, false);
        });
    }
    public Map<String, Object> removeAttribute(String id, long revision, String issueId, String attributeId) {
        return mutate(id, revision, root -> remove(target(root, issueId).children("attributes"), attributeId));
    }
    public Map<String, Object> upsertIssue(String id, long revision, String issueId, Map<String, Object> values) {
        return mutate(id, revision, root -> {
            requireSeries(root);
            List<Node> issues = root.children("issues");
            Node issue = findForUpsert(issues, issueId, values.get("identifier"), "identifier");
            if (issue == null) { issue = new Node("issue"); issues.add(issue); }
            FieldCatalog.patch(issue, values, true);
        });
    }
    public Map<String, Object> removeIssue(String id, long revision, String issueId) {
        return mutate(id, revision, root -> { requireSeries(root); remove(root.children("issues"), issueId); });
    }
    public Map<String, Object> discard(String id, long revision) {
        Draft draft = requireDraft(id);
        synchronized (imports) {
            synchronized (draft) {
                check(draft, revision); draft.discarded = true; drafts.remove(id, draft);
                imports.entrySet().removeIf(entry -> entry.getValue().draftId().equals(id));
                return Map.of("draft_id", id, "discarded", true, "revision", revision);
            }
        }
    }
    public Map<String, Object> validate(String id, long revision) {
        Snapshot snapshot = snapshot(id, revision);
        var report = interlis.validate(interlis.write(snapshot.transfer()));
        return Map.of("draft_id", id, "revision", snapshot.revision(),
                "valid", report.valid(), "messages", report.messages());
    }
    public Map<String, Object> export(String id, long revision, boolean includeXml) {
        if (exports.isEmpty() && !includeXml)
            throw new ToolError("invalid_arguments", "export_xtf über STDIO benötigt include_xml=true; der Client speichert das XML lokal.");
        Snapshot snapshot = snapshot(id, revision);
        String xml = interlis.write(snapshot.transfer());
        var report = interlis.validate(xml);
        if (!report.valid()) throw new ToolError("validation_failed", "Das Datenblatt ist nicht exportierbar.",
                Map.of("revision", snapshot.revision(), "messages", report.messages()));
        String identifier = Objects.toString(snapshot.transfer().root().values.get("identifier"), "dataset");
        String filename = identifier.replaceAll("[^\\p{L}\\p{N}._-]", "_");
        if (filename.isBlank()) filename = "dataset";
        String fileName = filename + ".xtf";
        Map<String, Object> result = new LinkedHashMap<>(Map.of(
                "draft_id", id, "revision", snapshot.revision(), "file_name", fileName,
                "messages", report.messages()));
        exports.ifPresent(store -> {
            var link = store.put(xml.getBytes(StandardCharsets.UTF_8), fileName);
            result.put("download_url", link.url());
            result.put("expires_at", link.expiresAt().toString());
        });
        if (includeXml) result.put("xml", xml);
        return result;
    }

    private Map<String, Object> mutate(String id, long revision, Consumer<Node> mutation) {
        Draft draft = requireDraft(id);
        synchronized (draft) {
            check(draft, revision);
            Node next = draft.root.copy();
            Map<String, Object> before = draft.root.json();
            mutation.accept(next); // No partially applied changes if any field fails.
            draft.root = next; draft.revision++;
            Map<String, Object> result = new LinkedHashMap<>(snapshotLocked(draft).json());
            List<Map<String, Object>> changes = new ArrayList<>();
            diff("", before, next.json(), changes);
            result.put("changes", changes);
            return result;
        }
    }
    @SuppressWarnings("unchecked")
    private static void diff(String path, Object before, Object after, List<Map<String, Object>> changes) {
        if (Objects.equals(before, after)) return;
        if (before instanceof Map<?, ?> b && after instanceof Map<?, ?> a) {
            Set<String> keys = new LinkedHashSet<>(((Map<String, Object>) b).keySet());
            keys.addAll(((Map<String, Object>) a).keySet());
            for (String key : keys) diff(path + "/" + key, b.get(key), a.get(key), changes);
        } else {
            Map<String, Object> change = new LinkedHashMap<>();
            change.put("path", path); change.put("before", before); change.put("after", after);
            changes.add(change);
        }
    }
    private Snapshot snapshot(String id, Long revision) {
        Draft draft = requireDraft(id);
        synchronized (draft) { check(draft, revision); return snapshotLocked(draft); }
    }
    private Snapshot snapshotLocked(Draft draft) {
        return new Snapshot(draft.id, draft.revision, new Transfer(draft.root.copy(), draft.basketId, draft.objectId));
    }
    private Draft requireDraft(String id) {
        Draft draft = drafts.get(id);
        if (draft == null) throw new ToolError("not_found", "Entwurf nicht gefunden: " + id);
        return draft;
    }
    private static void check(Draft draft, Long revision) {
        if (draft.discarded) throw new ToolError("not_found", "Entwurf wurde verworfen.");
        if (revision != null && revision != draft.revision)
            throw new ToolError("revision_conflict", "Entwurf wurde zwischenzeitlich geändert.",
                    Map.of("expected_revision", revision, "current_revision", draft.revision));
    }
    private static void requireSeries(Node root) {
        if (!root.kind.equals("series")) throw new ToolError("invalid_arguments", "Dataset hat keine Ausgaben.");
    }
    private static Node target(Node root, String issueId) {
        if (issueId == null) return root;
        requireSeries(root);
        return findById(root.children("issues"), issueId);
    }
    private static Node findById(List<Node> nodes, String id) {
        return nodes.stream().filter(node -> node.id.equals(id)).findFirst()
                .orElseThrow(() -> new ToolError("not_found", "Eintrag nicht gefunden: " + id));
    }
    private static Node findForUpsert(List<Node> nodes, String id, Object name, String key) {
        if (id != null) return findById(nodes, id);
        if (!(name instanceof String text) || text.isBlank())
            throw new ToolError("invalid_arguments", "Ohne interne ID ist " + key + " erforderlich.");
        List<Node> matches = nodes.stream().filter(node -> name.equals(node.values.get(key))).toList();
        if (matches.size() > 1) throw new ToolError("ambiguous_match", "Mehrere Einträge gefunden.",
                Map.of("candidates", matches.stream().map(Node::json).toList()));
        return matches.isEmpty() ? null : matches.getFirst();
    }
    private static void remove(List<Node> nodes, String id) { nodes.remove(findById(nodes, id)); }
}
