FROM gradle:9.7.1-jdk25 AS build
WORKDIR /app
COPY settings.gradle build.gradle gradle.properties ./
COPY src ./src
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:25-jre-noble AS runtime
ARG IMAGE_VERSION=local
ARG GIT_COMMIT=unknown
ARG SOURCE_REPOSITORY=https://github.com/sogis/datenportal-datenblatt-editor
LABEL org.opencontainers.image.source="${SOURCE_REPOSITORY}" \
      org.opencontainers.image.title="datenportal-datenblatt-mcp" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"
RUN useradd --system --create-home --uid 10001 app
WORKDIR /app
ENV SPRING_PROFILES_ACTIVE=http DATASHEET_HOST=0.0.0.0 DATASHEET_PORT=8000
USER app
EXPOSE 8000
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

# CI uses the already tested canonical JAR, without rebuilding it per architecture.
FROM runtime AS canonical
COPY build/libs/datasheet-mcp.jar /app/app.jar
COPY src/main/resources/models/ /app/models/

# Default local build compiles directly from source.
FROM runtime AS source
COPY --from=build /app/build/libs/datasheet-mcp.jar /app/app.jar
COPY --from=build /app/src/main/resources/models/ /app/models/
