package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomFieldsValidation(t *testing.T) {
	for _, test := range []struct {
		name, fields string
		valid        bool
	}{
		{"omitted", "null", true},
		{"clear", "[]", true},
		{"native values", `[{"name":"s","value":""},{"name":"n","value":-2.5,"type":"number"},{"name":"b","value":false,"type":"boolean"}]`, true},
		{"type mismatch", `[{"name":"n","value":"1","type":"number"}]`, false},
		{"unknown type", `[{"name":"n","value":"2026-01-01","type":"date"}]`, false},
		{"empty type", `[{"name":"n","value":1,"type":""}]`, false},
		{"null type", `[{"name":"n","value":1,"type":null}]`, false},
		{"numeric type", `[{"name":"n","value":1,"type":1}]`, false},
		{"null label", `[{"name":"n","value":1,"label":null}]`, false},
		{"unknown property", `[{"name":"n","value":1,"format":"date"}]`, false},
		{"object value", `[{"name":"n","value":{}}]`, false},
		{"array value", `[{"name":"n","value":[]}]`, false},
		{"null value", `[{"name":"n","value":null}]`, false},
		{"missing value", `[{"name":"n"}]`, false},
		{"missing name", `[{"value":1}]`, false},
		{"null field", `[null]`, false},
		{"blank name", `[{"name":"  ","value":1}]`, false},
		{"blank unicode name", `[{"name":"\u2003","value":1}]`, false},
		{"blank BOM name", `[{"name":"\ufeff","value":1}]`, false},
		{"blank mixed BOM name", `[{"name":" \ufeff\u2003 ","value":1}]`, false},
		{"duplicate name", `[{"name":"n","value":1},{"name":"n","value":2}]`, false},
		{"name control", `[{"name":"n\t","value":1}]`, false},
		{"label control", `[{"name":"n","value":1,"label":"x\u0085"}]`, false},
		{"value control", `[{"name":"n","value":"a\nb"}]`, false},
		{"nonfinite number", `[{"name":"n","value":1e400}]`, false},
		{"finite exponent", `[{"name":"n","value":1e20}]`, true},
		{"html remains text", `[{"name":"html","value":"<script>alert(1)</script>"}]`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			// Given the literal webhook JSON supplied by a sender.
			body := []byte(`{"title":"build","custom_fields":` + test.fields + `}`)

			// When it passes through the real decode and validation boundary.
			payload, handlerErr := decodeWebhookPayload(body)
			if handlerErr == nil {
				handlerErr = validateWebhookPayload(payload, nil)
			}

			// Then only supported scalar metadata is accepted.
			assert.Equal(t, test.valid, handlerErr == nil)
		})
	}
}

func TestCustomFieldsUnicodeLimits(t *testing.T) {
	for _, test := range []struct {
		name  string
		limit int
		set   func(*CustomField, string)
	}{
		{"name", maxCustomFieldNameLength, func(field *CustomField, value string) { field.Name = value }},
		{"label", maxCustomFieldLabelLength, func(field *CustomField, value string) { field.Label = value }},
		{"value", maxCustomFieldValueLength, func(field *CustomField, value string) {
			encoded, err := json.Marshal(value)
			require.NoError(t, err)
			field.Value = encoded
		}},
	} {
		for _, extra := range []int{0, 1} {
			t.Run(test.name+strings.Repeat("+", extra), func(t *testing.T) {
				// Given a Unicode value at or beyond the allowed codepoint limit.
				field := CustomField{Name: "stage", Value: json.RawMessage(`"review"`)}
				test.set(&field, strings.Repeat("🙂", test.limit+extra))

				// When the webhook metadata boundary validates it.
				err := validateCustomFields([]CustomField{field})

				// Then only the value within the documented limit is accepted.
				assert.Equal(t, extra == 0, err == nil)
			})
		}
	}
}

func TestCustomFieldsCountLimit(t *testing.T) {
	for _, count := range []int{maxCustomFields, maxCustomFields + 1} {
		// Given uniquely named fields at or beyond the array limit.
		fields := make([]CustomField, count)
		for i := range fields {
			fields[i] = CustomField{Name: strings.Repeat("a", i+1), Value: json.RawMessage("true")}
		}

		// When the webhook boundary validates the array.
		err := validateCustomFields(fields)

		// Then only the allowed field count is accepted.
		assert.Equal(t, count == maxCustomFields, err == nil)
	}
}

func TestCustomFieldsListProjection(t *testing.T) {
	// Given stored custom fields with native scalar values.
	fields := []CustomField{{Name: "stage", Value: json.RawMessage(`"review"`)}, {Name: "approved", Value: json.RawMessage("false")}}
	events := []Event{{ID: "event-1", CustomFields: fields}}

	// When list and unread responses project stored events for a viewer.
	projected := clientEventsFrom(events, "user-1")

	// Then the projection retains field order, labels, and scalar types.
	require.Len(t, projected, 1)
	assert.Equal(t, fields, projected[0].CustomFields)
}

func TestCustomFieldsSchemaLimits(t *testing.T) {
	// Given the public webhook schema.
	schema := readSchema(t, "timeline-event.schema.json")

	// When the custom field constraints are read.
	fields := schema["properties"].(map[string]any)["custom_fields"].(map[string]any)
	field := schema["$defs"].(map[string]any)["customField"].(map[string]any)
	properties := field["properties"].(map[string]any)
	valueOptions := properties["value"].(map[string]any)["oneOf"].([]any)

	// Then public bounds agree with the runtime boundary.
	assert.Equal(t, float64(maxCustomFields), fields["maxItems"])
	assert.Equal(t, float64(maxCustomFieldNameLength), properties["name"].(map[string]any)["maxLength"])
	assert.Equal(t, float64(maxCustomFieldLabelLength), properties["label"].(map[string]any)["maxLength"])
	assert.Equal(t, float64(maxCustomFieldValueLength), valueOptions[0].(map[string]any)["maxLength"])
	assert.Equal(t, false, field["additionalProperties"])
	assert.Equal(t, []any{"string", "number", "boolean"}, properties["type"].(map[string]any)["enum"])
}
