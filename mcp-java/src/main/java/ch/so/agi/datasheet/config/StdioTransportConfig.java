/*
 * Adapted from interlis-mcp, Copyright (c) 2025 Stefan Ziegler.
 * MIT license: src/main/resources/META-INF/LICENSE-interlis-mcp.txt.
 */
package ch.so.agi.datasheet.config;

import ch.so.agi.datasheet.transport.SerializedStdioServerTransportProvider;
import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper;
import io.modelcontextprotocol.spec.McpServerTransportProviderBase;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import tools.jackson.databind.json.JsonMapper;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
    prefix = "spring.ai.mcp.server",
    name = "stdio",
    havingValue = "true")
public class StdioTransportConfig {

  @Bean
  @ConditionalOnMissingBean(McpServerTransportProviderBase.class)
  public McpServerTransportProviderBase serializedStdioServerTransport(
      @Qualifier("mcpServerJsonMapper") JsonMapper jsonMapper,
      Environment environment) {
    boolean shutdownOnEof = environment.getProperty(
        "datasheet.mcp.stdio.shutdown-on-eof", Boolean.class, false);
    return new SerializedStdioServerTransportProvider(
        new JacksonMcpJsonMapper(jsonMapper), shutdownOnEof);
  }
}
