package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type configuration struct {
	WebhookSecret         string `json:"WebhookSecret"`
	WebhookTokens         string `json:"WebhookTokens"`
	RequireSignedWebhooks bool   `json:"RequireSignedWebhooks"`
	WebhookTools          string `json:"WebhookTools"`
	MaxEventsStored       string `json:"MaxEventsStored"`
	MaxEventsDisplayed    string `json:"MaxEventsDisplayed"`
	TimelineOrder         string `json:"TimelineOrder"`
	EnableReactions       bool   `json:"EnableReactions"`
}

func (c *configuration) timelineOrder() TimelineOrder {
	switch TimelineOrder(c.TimelineOrder) {
	case TimelineOrderNewestFirst, TimelineOrderOldestFirst:
		return TimelineOrder(c.TimelineOrder)
	default:
		return TimelineOrderOldestFirst
	}
}

func (c *configuration) enableReactions() bool {
	return c.EnableReactions
}

func (c *configuration) Clone() *configuration {
	clone := *c
	return &clone
}

func (c *configuration) maxEventsStoredInt() int {
	n, err := strconv.Atoi(c.MaxEventsStored)
	if err != nil || n <= 0 {
		return 500
	}
	return n
}

func (c *configuration) maxEventsDisplayedInt() int {
	n, err := strconv.Atoi(c.MaxEventsDisplayed)
	if err != nil || n <= 0 {
		return 100
	}
	return n
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}

	return p.configuration
}

func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	if configuration != nil && p.configuration == configuration {
		panic("setConfiguration called with the existing configuration")
	}

	p.configuration = configuration
}

func (p *Plugin) OnConfigurationChange() error {
	configuration := new(configuration)

	settings := make(map[string]interface{})
	if manifest.SettingsSchema != nil {
		for _, setting := range manifest.SettingsSchema.Settings {
			settings[strings.ToLower(setting.Key)] = setting.Default
		}
		for _, section := range manifest.SettingsSchema.Sections {
			for _, setting := range section.Settings {
				settings[strings.ToLower(setting.Key)] = setting.Default
			}
		}
	}
	config := p.API.GetUnsanitizedConfig()
	if config == nil {
		return fmt.Errorf("failed to load plugin configuration: server configuration unavailable")
	}
	stored := config.PluginSettings.Plugins[manifest.Id]
	keys := make([]string, 0, len(stored))
	for key := range stored {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		canonical := strings.ToLower(key)
		// Native Mattermost saves use lowercase keys. Prefer them, including
		// explicit empty/false values, over legacy aliases on every node.
		if value, exists := stored[canonical]; exists {
			settings[canonical] = value
		} else {
			settings[canonical] = stored[key]
		}
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to encode plugin configuration: %w", err)
	}
	if err := json.Unmarshal(encoded, configuration); err != nil {
		return fmt.Errorf("failed to load plugin configuration: %w", err)
	}

	p.setConfiguration(configuration)

	if p.store != nil {
		p.store.SetMaxEvents(configuration.maxEventsStoredInt())
	}

	return nil
}
