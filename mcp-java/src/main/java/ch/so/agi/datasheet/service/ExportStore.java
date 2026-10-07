package ch.so.agi.datasheet.service;

import java.net.URI;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.context.annotation.Profile;

/** Immutable, short-lived copies of bytes that have already passed ilivalidator. */
@Component
@Profile("http")
public class ExportStore {
    public record Export(byte[] bytes, String fileName, Instant expiresAt) {
        public Export { bytes = bytes.clone(); }
        @Override public byte[] bytes() { return bytes.clone(); }
    }
    public record Link(String url, Instant expiresAt) {}
    private final ConcurrentHashMap<String, Export> exports = new ConcurrentHashMap<>();
    private final Clock clock;
    private final String publicBaseUrl;

    public ExportStore(Clock clock, @Value("${datasheet.public-base-url}") String publicBaseUrl) {
        URI uri = URI.create(publicBaseUrl);
        if (!Set.of("http", "https").contains(Objects.toString(uri.getScheme(), ""))
                || uri.getHost() == null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || uri.getUserInfo() != null) throw new IllegalArgumentException("Invalid datasheet.public-base-url");
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }
    public Link put(byte[] validatedBytes, String fileName) {
        String token = UUID.randomUUID().toString();
        Instant expiry = clock.instant().plus(Duration.ofHours(1));
        exports.put(token, new Export(validatedBytes, fileName, expiry));
        return new Link(publicBaseUrl + "/api/exports/" + token, expiry);
    }
    public Optional<Export> get(String token) {
        Export export = exports.get(token);
        if (export != null && !clock.instant().isBefore(export.expiresAt())) {
            exports.remove(token, export); return Optional.empty();
        }
        return Optional.ofNullable(export);
    }
    @Scheduled(fixedDelay = 60_000)
    public void removeExpired() {
        Instant now = clock.instant();
        exports.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));
    }
}
