package ch.so.agi.datasheet;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import java.util.Map;

@SpringBootApplication
public class DatasheetApplication {
    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(DatasheetApplication.class);
        application.setDefaultProperties(Map.of("datasheet.mcp.stdio.shutdown-on-eof", "true"));
        application.run(args);
    }
}
