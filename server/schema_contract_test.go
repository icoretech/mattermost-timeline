package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTimelineEventSchemaMatchesWebhookPayloadContract(t *testing.T) {
	schema := readSchema(t, "timeline-event.schema.json")
	properties, ok := schema["properties"].(map[string]any)
	require.True(t, ok)

	payloadType := reflect.TypeOf(WebhookPayload{})
	for i := 0; i < payloadType.NumField(); i++ {
		field := payloadType.Field(i)
		jsonName := strings.Split(field.Tag.Get("json"), ",")[0]
		if jsonName == "" || jsonName == "-" {
			continue
		}
		assert.Contains(t, properties, jsonName)
	}

	require.Equal(t, []any{"title"}, schema["required"])
	assertSchemaEnumEquals(t, properties, "severity", allowedSeverities)
	assertSchemaEnumEquals(t, properties, "status", allowedStatuses)
}

func TestTimelineBatchSchemaMaxItemsMatchesServerLimit(t *testing.T) {
	schema := readSchema(t, "timeline-batch.schema.json")
	variants, ok := schema["oneOf"].([]any)
	require.True(t, ok)
	require.Len(t, variants, 2)

	arrayVariant := variants[0].(map[string]any)
	assert.Equal(t, float64(maxWebhookBatchEvents), arrayVariant["maxItems"])

	objectVariant := variants[1].(map[string]any)
	properties := objectVariant["properties"].(map[string]any)
	events := properties["events"].(map[string]any)
	assert.Equal(t, float64(maxWebhookBatchEvents), events["maxItems"])
}

func TestTimelineEventSchemaCharacterLimitsMatchUnicodeValidation(t *testing.T) {
	schema := readSchema(t, "timeline-event.schema.json")
	properties := schema["properties"].(map[string]any)
	tests := []struct {
		field string
		set   func(*WebhookPayload, string)
	}{
		{"title", func(payload *WebhookPayload, value string) { payload.Title = value }},
		{"message", func(payload *WebhookPayload, value string) { payload.Message = value }},
		{"source", func(payload *WebhookPayload, value string) { payload.Source = value }},
		{"external_id", func(payload *WebhookPayload, value string) { payload.ExternalID = value }},
		{"event_type", func(payload *WebhookPayload, value string) { payload.EventType = value }},
		{"environment", func(payload *WebhookPayload, value string) { payload.Environment = &value }},
	}
	for _, test := range tests {
		t.Run(test.field, func(t *testing.T) {
			limit := int(properties[test.field].(map[string]any)["maxLength"].(float64))
			payload := WebhookPayload{Title: "Sample event"}
			test.set(&payload, strings.Repeat("🙂", limit))
			assert.Nil(t, validateWebhookPayload(payload, nil))
			test.set(&payload, strings.Repeat("🙂", limit+1))
			assert.NotNil(t, validateWebhookPayload(payload, nil))
		})
	}
}

func TestWebhookLinkValidationRejectsControlCharacters(t *testing.T) {
	for _, value := range []string{"java\nscript:alert(1)", "java\tscript:alert(1)", "https://example.com/\rpath"} {
		assert.NotNil(t, validateWebhookLink(EventLink{URL: value}))
	}
}

func readSchema(t *testing.T, name string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "schema", name))
	require.NoError(t, err)

	var schema map[string]any
	require.NoError(t, json.Unmarshal(data, &schema))
	return schema
}

func assertSchemaEnumEquals(t *testing.T, properties map[string]any, field string, expected []string) {
	t.Helper()
	fieldSchema, ok := properties[field].(map[string]any)
	require.True(t, ok)
	enumValues, ok := fieldSchema["enum"].([]any)
	require.True(t, ok)
	actual := make([]string, 0, len(enumValues))
	for _, value := range enumValues {
		actual = append(actual, value.(string))
	}
	assert.Equal(t, expected, actual)
}
