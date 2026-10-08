package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCustomFields = 20
const maxCustomFieldNameLength = 64
const maxCustomFieldLabelLength = 80
const maxCustomFieldValueLength = 1000

// CustomField is ordered, display-only metadata with a native JSON scalar value.
type CustomField struct {
	Name  string          `json:"name"`
	Value json.RawMessage `json:"value"`
	Type  string          `json:"type,omitempty"`
	Label string          `json:"label,omitempty"`
}

// UnmarshalJSON distinguishes omitted optional strings from explicit nulls.
func (field *CustomField) UnmarshalJSON(data []byte) error {
	type plainField CustomField
	var decoded plainField
	wire := struct {
		*plainField
		Type  json.RawMessage `json:"type"`
		Label json.RawMessage `json:"label"`
	}{plainField: &decoded}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return fmt.Errorf("decode custom field: %w", err)
	}
	for _, optional := range []struct {
		name   string
		raw    json.RawMessage
		target *string
	}{
		{"type", wire.Type, &decoded.Type},
		{"label", wire.Label, &decoded.Label},
	} {
		if len(optional.raw) == 0 {
			continue
		}
		if bytes.Equal(optional.raw, []byte("null")) {
			return fmt.Errorf("custom field %s must be a string", optional.name)
		}
		if err := json.Unmarshal(optional.raw, optional.target); err != nil {
			return fmt.Errorf("decode custom field %s: %w", optional.name, err)
		}
	}
	if len(wire.Type) != 0 && decoded.Type == "" {
		return fmt.Errorf("custom field type cannot be empty")
	}
	*field = CustomField(decoded)
	return nil
}

func validateCustomFields(fields []CustomField) *webhookHandlerError {
	if len(fields) > maxCustomFields {
		return &webhookHandlerError{message: "Maximum 20 custom fields per event", status: http.StatusBadRequest}
	}
	names := make(map[string]struct{}, len(fields))
	for _, field := range fields {
		trimmedName := strings.TrimFunc(field.Name, func(r rune) bool {
			return unicode.IsSpace(r) || r == '\uFEFF'
		})
		if trimmedName == "" || utf8.RuneCountInString(field.Name) > maxCustomFieldNameLength || containsControlCharacter(field.Name) {
			return &webhookHandlerError{message: "Invalid custom field name", status: http.StatusBadRequest}
		}
		if _, exists := names[field.Name]; exists {
			return &webhookHandlerError{message: "Duplicate custom field name", status: http.StatusBadRequest}
		}
		names[field.Name] = struct{}{}
		if utf8.RuneCountInString(field.Label) > maxCustomFieldLabelLength || containsControlCharacter(field.Label) {
			return &webhookHandlerError{message: "Invalid custom field label", status: http.StatusBadRequest}
		}
		if err := validateCustomFieldValue(field); err != nil {
			return &webhookHandlerError{message: err.Error(), status: http.StatusBadRequest}
		}
	}
	return nil
}

func validateCustomFieldValue(field CustomField) error {
	value := bytes.TrimSpace(field.Value)
	if len(value) == 0 || !json.Valid(value) {
		return fmt.Errorf("custom field value is required")
	}
	var valueType string
	switch value[0] {
	case '"':
		var text string
		if err := json.Unmarshal(value, &text); err != nil {
			return fmt.Errorf("decode custom field string: %w", err)
		}
		if utf8.RuneCountInString(text) > maxCustomFieldValueLength || containsControlCharacter(text) {
			return fmt.Errorf("invalid custom field string value")
		}
		valueType = "string"
	case 't', 'f':
		valueType = "boolean"
	case '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		var number float64
		if err := json.Unmarshal(value, &number); err != nil {
			return fmt.Errorf("custom field number must be finite: %w", err)
		}
		valueType = "number"
	default:
		return fmt.Errorf("custom field value must be a string, number, or boolean")
	}
	if field.Type != "" && field.Type != valueType {
		return fmt.Errorf("custom field type must match its value")
	}
	return nil
}
