package ch.so.agi.datasheet.http;

import ch.so.agi.datasheet.service.ExportStore;
import java.nio.charset.StandardCharsets;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.context.annotation.Profile;

@RestController
@Profile("http")
public class ExportController {
    private final ExportStore store;
    public ExportController(ExportStore store) { this.store = store; }

    @GetMapping("/api/exports/{token}")
    public ResponseEntity<byte[]> download(@PathVariable String token) {
        return store.get(token).map(export -> ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/xml; charset=UTF-8"))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(export.fileName(), StandardCharsets.UTF_8).build().toString())
                .body(export.bytes()))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .cacheControl(CacheControl.noStore()).build());
    }
}
