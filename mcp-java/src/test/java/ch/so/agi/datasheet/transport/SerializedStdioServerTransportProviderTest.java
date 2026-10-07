/*
 * Adapted from interlis-mcp, Copyright (c) 2025 Stefan Ziegler.
 * MIT license: src/main/resources/META-INF/LICENSE-interlis-mcp.txt.
 */
package ch.so.agi.datasheet.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapperSupplier;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.JSONRPCMessage;
import io.modelcontextprotocol.spec.McpSchema.JSONRPCResponse;
import io.modelcontextprotocol.spec.McpServerSession;
import io.modelcontextprotocol.spec.McpServerTransport;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class SerializedStdioServerTransportProviderTest {

  private final McpJsonMapper jsonMapper = new JacksonMcpJsonMapperSupplier().get();

  @Test
  void alreadyClosedInputCanStartAndStopWithoutRejectingTheWriter() {
    for (int attempt = 0; attempt < 32; attempt++) {
      var provider = new SerializedStdioServerTransportProvider(
          jsonMapper, new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream());
      var session = mock(McpServerSession.class);
      when(session.closeGracefully()).thenReturn(Mono.empty());
      try {
        provider.setSessionFactory(transport -> session);
      } finally {
        provider.close();
      }
    }
  }

  @Test
  void concurrentlyQueuedResponsesAreAllWrittenAsJsonLines() throws Exception {
    try (PipedInputStream input = new PipedInputStream();
        PipedOutputStream inputWriter = new PipedOutputStream(input)) {
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      SerializedStdioServerTransportProvider provider =
          new SerializedStdioServerTransportProvider(jsonMapper, input, output);
      McpServerSession session = mock(McpServerSession.class);
      when(session.getId()).thenReturn("test-session");
      when(session.closeGracefully()).thenReturn(Mono.empty());
      AtomicReference<McpServerTransport> transportReference = new AtomicReference<>();

      provider.setSessionFactory(transport -> {
        transportReference.set(transport);
        return session;
      });

      waitForValue(transportReference);
      McpServerTransport transport = transportReference.get();
      List<Mono<Void>> sends = new ArrayList<>();
      for (int id = 1; id <= 32; id++) {
        JSONRPCMessage response = McpSchema.JSONRPCResponse.result(id, java.util.Map.of("ok", true));
        sends.add(transport.sendMessage(response));
      }

      Flux.merge(sends).then().block(Duration.ofSeconds(5));
      waitForLineCount(output, 32);

      String[] lines = output.toString(StandardCharsets.UTF_8).trim().split("\\R");
      assertThat(lines).hasSize(32);
      Set<Object> ids = new HashSet<>();
      for (String line : lines) {
        JSONRPCMessage message = McpSchema.deserializeJsonRpcMessage(jsonMapper, line);
        assertThat(message).isInstanceOf(JSONRPCResponse.class);
        ids.add(((JSONRPCResponse) message).id());
      }
      assertThat(ids).containsExactlyInAnyOrderElementsOf(
          java.util.stream.IntStream.rangeClosed(1, 32).boxed().toList());

      provider.close();
      inputWriter.close();
    }
  }

  private void waitForValue(AtomicReference<?> reference) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (reference.get() == null && System.nanoTime() < deadline) {
      Thread.sleep(10);
    }
    assertThat(reference.get()).isNotNull();
  }

  private void waitForLineCount(ByteArrayOutputStream output, int expected)
      throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (lineCount(output) < expected && System.nanoTime() < deadline) {
      Thread.sleep(10);
    }
    assertThat(lineCount(output)).isEqualTo(expected);
  }

  private int lineCount(ByteArrayOutputStream output) {
    String text = output.toString(StandardCharsets.UTF_8);
    if (text.isEmpty()) {
      return 0;
    }
    return text.split("\\R").length;
  }
}
