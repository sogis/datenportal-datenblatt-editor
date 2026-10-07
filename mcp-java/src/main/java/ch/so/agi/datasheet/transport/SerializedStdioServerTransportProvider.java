/*
 * Adapted from interlis-mcp, Copyright (c) 2025 Stefan Ziegler.
 * MIT license: src/main/resources/META-INF/LICENSE-interlis-mcp.txt.
 */
package ch.so.agi.datasheet.transport;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.TypeRef;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.JSONRPCMessage;
import io.modelcontextprotocol.spec.McpServerSession;
import io.modelcontextprotocol.spec.McpServerTransport;
import io.modelcontextprotocol.spec.McpServerTransportProvider;
import io.modelcontextprotocol.util.Assert;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.context.ConfigurableApplicationContext;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * STDIO transport with a single writer queue.
 *
 * <p>The upstream SDK transport processes inbound messages concurrently but
 * attempts to enqueue concurrent responses through a Reactor unicast sink.
 * A dedicated FIFO queue makes the single-writer requirement explicit while
 * preserving concurrent request handling.</p>
 */
public final class SerializedStdioServerTransportProvider
    implements McpServerTransportProvider, ApplicationContextAware {

  private static final Logger logger = LoggerFactory.getLogger(
      SerializedStdioServerTransportProvider.class);

  private final McpJsonMapper jsonMapper;
  private final InputStream inputStream;
  private final OutputStream outputStream;
  private final boolean shutdownApplicationOnEof;
  private final AtomicBoolean closing = new AtomicBoolean(false);
  private final ExecutorService inboundExecutor = Executors.newSingleThreadExecutor(
      runnable -> new Thread(runnable, "stdio-inbound"));
  private final ExecutorService outboundExecutor = Executors.newSingleThreadExecutor(
      runnable -> new Thread(runnable, "stdio-outbound"));
  private final BlockingQueue<JSONRPCMessage> outboundQueue = new LinkedBlockingQueue<>();

  private volatile McpServerSession session;
  private volatile ConfigurableApplicationContext applicationContext;

  @Override
  public void setApplicationContext(ApplicationContext applicationContext) {
    if (applicationContext instanceof ConfigurableApplicationContext configurableContext) {
      this.applicationContext = configurableContext;
    }
  }

  public SerializedStdioServerTransportProvider(McpJsonMapper jsonMapper) {
    this(jsonMapper, System.in, System.out, false);
  }

  public SerializedStdioServerTransportProvider(
      McpJsonMapper jsonMapper,
      InputStream inputStream,
      OutputStream outputStream) {
    this(jsonMapper, inputStream, outputStream, false);
  }

  public SerializedStdioServerTransportProvider(
      McpJsonMapper jsonMapper,
      boolean shutdownApplicationOnEof) {
    this(jsonMapper, System.in, System.out, shutdownApplicationOnEof);
  }

  public SerializedStdioServerTransportProvider(
      McpJsonMapper jsonMapper,
      InputStream inputStream,
      OutputStream outputStream,
      boolean shutdownApplicationOnEof) {
    Assert.notNull(jsonMapper, "The JsonMapper can not be null");
    Assert.notNull(inputStream, "The InputStream can not be null");
    Assert.notNull(outputStream, "The OutputStream can not be null");
    this.jsonMapper = jsonMapper;
    this.inputStream = inputStream;
    this.outputStream = outputStream;
    this.shutdownApplicationOnEof = shutdownApplicationOnEof;
  }

  @Override
  public void setSessionFactory(McpServerSession.Factory sessionFactory) {
    var transport = new SerializedStdioSessionTransport();
    this.session = sessionFactory.create(transport);
    transport.start();
  }

  @Override
  public Mono<Void> notifyClients(String method, Object params) {
    McpServerSession currentSession = session;
    if (currentSession == null) {
      return Mono.error(new IllegalStateException("No session to notify"));
    }
    return currentSession.sendNotification(method, params)
        .doOnError(error -> logger.error("Failed to send notification: {}", error.getMessage()));
  }

  @Override
  public Mono<Void> notifyClient(String sessionId, String method, Object params) {
    return Mono.defer(() -> {
      McpServerSession currentSession = session;
      if (currentSession == null) {
        return Mono.error(new IllegalStateException("No session to notify"));
      }
      if (!currentSession.getId().equals(sessionId)) {
        return Mono.error(new IllegalStateException(
            "Existing session id " + currentSession.getId()
                + " doesn't match the notification target: " + sessionId));
      }
      return currentSession.sendNotification(method, params);
    });
  }

  @Override
  public Mono<Void> closeGracefully() {
    McpServerSession currentSession = session;
    if (currentSession == null) {
      closeExecutors();
      return Mono.empty();
    }
    return currentSession.closeGracefully();
  }

  @Override
  public void close() {
    closeTransport();
  }

  private void closeTransport() {
    if (closing.compareAndSet(false, true)) {
      McpServerSession currentSession = session;
      if (currentSession != null) {
        currentSession.close();
      }
      closeExecutors();
    }
  }

  private void closeExecutors() {
    inboundExecutor.shutdownNow();
    outboundExecutor.shutdown();
  }

  private void closeApplicationContextAsync() {
    if (!shutdownApplicationOnEof) {
      return;
    }
    ConfigurableApplicationContext currentContext = applicationContext;
    if (currentContext == null || !currentContext.isActive()) {
      return;
    }
    Thread shutdownThread = new Thread(() -> {
      try {
        currentContext.close();
      } catch (Exception error) {
        logger.warn("Error closing Spring application context after STDIO shutdown", error);
      }
    }, "stdio-context-shutdown");
    shutdownThread.setDaemon(true);
    shutdownThread.start();
  }

  private void failTransport(String message, Throwable error) {
    if (closing.compareAndSet(false, true)) {
      logger.error(message, error);
      McpServerSession currentSession = session;
      if (currentSession != null) {
        currentSession.close();
      }
      closeExecutors();
      closeApplicationContextAsync();
    }
  }

  private final class SerializedStdioSessionTransport implements McpServerTransport {

    private final Sinks.Many<JSONRPCMessage> inboundSink =
        Sinks.many().unicast().onBackpressureBuffer();

    private void start() {
      handleIncomingMessages();
      startOutboundProcessing();
      // EOF can complete the inbound sink and shut down both executors immediately.
      // Start the writer before the reader so an empty input cannot race its submission.
      startInboundProcessing();
    }

    @Override
    public Mono<Void> sendMessage(JSONRPCMessage message) {
      return Mono.defer(() -> {
        if (closing.get()) {
          return Mono.error(new IllegalStateException("STDIO transport is closed"));
        }
        if (!outboundQueue.offer(message)) {
          return Mono.error(new IllegalStateException("Failed to enqueue message"));
        }
        return Mono.empty();
      });
    }

    @Override
    public <T> T unmarshalFrom(Object data, TypeRef<T> typeRef) {
      return jsonMapper.convertValue(data, typeRef);
    }

    @Override
    public Mono<Void> closeGracefully() {
      closing.set(true);
      inboundSink.tryEmitComplete();
      outboundExecutor.shutdown();
      return Mono.empty();
    }

    @Override
    public void close() {
      closeTransport();
    }

    private void handleIncomingMessages() {
      inboundSink.asFlux()
          .flatMap(message -> session.handle(message))
          .doOnError(error -> failTransport("Error handling inbound MCP message", error))
          .doFinally(signal -> {
            if (!closing.get()) {
              closing.set(true);
              outboundExecutor.shutdown();
            }
          })
          .subscribe();
    }

    private void startInboundProcessing() {
      inboundExecutor.submit(() -> {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
          while (!closing.get()) {
            String line = reader.readLine();
            if (line == null) {
              break;
            }
            try {
              JSONRPCMessage message = McpSchema.deserializeJsonRpcMessage(jsonMapper, line);
              if (!inboundSink.tryEmitNext(message).isSuccess()) {
                failTransport("Failed to enqueue inbound MCP message", null);
                break;
              }
            } catch (Exception error) {
              failTransport("Error processing inbound MCP message", error);
              break;
            }
          }
        } catch (IOException error) {
          if (!closing.get()) {
            failTransport("Error reading from stdin", error);
          }
        } finally {
          if (closing.compareAndSet(false, true)) {
            inboundSink.tryEmitComplete();
            closeExecutors();
            closeApplicationContextAsync();
          }
        }
      });
    }

    private void startOutboundProcessing() {
      outboundExecutor.submit(() -> {
        try {
          while (!closing.get() || !outboundQueue.isEmpty()) {
            JSONRPCMessage message = outboundQueue.poll(100, TimeUnit.MILLISECONDS);
            if (message == null) {
              continue;
            }
            String jsonMessage = jsonMapper.writeValueAsString(message)
                .replace("\r\n", "\\n")
                .replace("\n", "\\n")
                .replace("\r", "\\n");
            outputStream.write(jsonMessage.getBytes(StandardCharsets.UTF_8));
            outputStream.write('\n');
            outputStream.flush();
          }
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          if (!closing.get()) {
            failTransport("STDIO writer interrupted", error);
          }
        } catch (IOException error) {
          if (!closing.get()) {
            failTransport("Error writing MCP message to stdout", error);
          }
        } finally {
          try {
            outputStream.flush();
          } catch (IOException error) {
            if (!closing.get()) {
              logger.error("Error flushing MCP stdout", error);
            }
          }
        }
      });
    }
  }
}
