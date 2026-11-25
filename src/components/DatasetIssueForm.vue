<script setup lang="ts">
import type { DatasetIssue, IssueInheritedGroup } from "../domain/datasetTypes";
import { fixedAccessLevel, fixedPublicationStatus } from "../config/vocabularies";
import {
  disableIssueIdentifierAuto,
  disableIssueTitleAuto,
  markIssueGroupOverridden
} from "../domain/seriesIssues";
import SharedMetadataSections from "./SharedMetadataSections.vue";

const props = defineProps<{
  issue: DatasetIssue;
}>();

const emit = defineEmits<{
  "set-current": [value: boolean];
  changed: [];
}>();

function updateIdentifier(value: string): void {
  disableIssueIdentifierAuto(props.issue);
  props.issue.identifier = value;
}

function updateTitle(value: string): void {
  disableIssueTitleAuto(props.issue);
  props.issue.title = value;
}

function markOverridden(group: IssueInheritedGroup): void {
  markIssueGroupOverridden(props.issue, group);
}
</script>

<template>
  <section class="surface surface--editor section-stack" @change="emit('changed')" @input="emit('changed')">
    <div class="header-line">
      <div>
        <h2>Ausgabe bearbeiten</h2>
        <p class="muted">
          {{
            issue.title || issue.issueLabel || "Bearbeiten Sie die Werte dieser Ausgabe. Nicht überschriebene Felder folgen weiter der Serie."
          }}
        </p>
      </div>
    </div>

    <section class="form-section section-stack">
      <div>
        <h3>Grundangaben</h3>
        <p class="field-help">IssueLabel steuert die automatische Ableitung von Identifier und Titel, solange diese Felder nicht manuell überschrieben wurden.</p>
      </div>
      <div class="field-grid">
        <div class="field-row">
          <label for="issue-label">IssueLabel *</label>
          <input id="issue-label" v-model="issue.issueLabel" class="text-input" type="text" />
        </div>
        <div class="inline-grid">
          <div class="field-row">
            <label for="issue-identifier">Identifier *</label>
            <input
              id="issue-identifier"
              :value="issue.identifier"
              class="text-input mono"
              type="text"
              @input="updateIdentifier(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="field-row">
            <label for="issue-title">Titel</label>
            <input
              id="issue-title"
              :value="issue.title"
              class="text-input"
              type="text"
              @input="updateTitle(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div class="field-row">
          <label for="issue-description">Beschreibung</label>
          <textarea
            id="issue-description"
            v-model="issue.description"
            class="textarea"
            rows="5"
            @input="markOverridden('description')"
          />
          <p class="field-help">{{ (issue.description ?? "").length }} / 1024 Zeichen</p>
        </div>
        <div class="inline-grid">
          <div class="field-row">
            <label for="issue-access-level">Zugänglichkeit *</label>
            <input id="issue-access-level" :value="fixedAccessLevel.label" class="text-input" type="text" readonly />
          </div>
          <div class="field-row">
            <label for="issue-publication-status">Publikationsstatus *</label>
            <input
              id="issue-publication-status"
              :value="fixedPublicationStatus.label"
              class="text-input"
              type="text"
              readonly
            />
          </div>
        </div>
        <label class="checkbox-item">
          <input
            :checked="issue.isCurrentIssue"
            type="checkbox"
            @change="emit('set-current', ($event.target as HTMLInputElement).checked)"
          />
          <span>Als aktuelle Ausgabe markieren</span>
        </label>
      </div>
    </section>

    <SharedMetadataSections :entry="issue" kind="issue" id-prefix="issue" track-overrides @override-group="markOverridden" />
  </section>
</template>
