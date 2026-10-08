package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPluginConfigMapUsesCanonicalKeys(t *testing.T) {
	config := &configuration{WebhookSecret: "sample-secret", WebhookTokens: "[]", MaxEventsStored: "501", TimelineOrder: "newest_first", EnableReactions: false}
	require.Equal(t, map[string]interface{}{
		"webhooksecret": "sample-secret", "webhooktokens": "[]", "requiresignedwebhooks": false,
		"webhooktools": "", "maxeventsstored": "501", "maxeventsdisplayed": "", "timelineorder": "newest_first", "enablereactions": false,
	}, pluginConfigMap(config))
}

func storedPluginConfig(settings map[string]interface{}) *model.Config {
	return &model.Config{PluginSettings: model.PluginSettings{Plugins: map[string]map[string]interface{}{manifest.Id: settings}}}
}

func TestOnConfigurationChange(t *testing.T) {
	t.Run("propagates load errors", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{}
		p.API = api

		api.On("GetUnsanitizedConfig").Return((*model.Config)(nil))

		err := p.OnConfigurationChange()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load plugin configuration")
		assert.Nil(t, p.configuration)
		api.AssertExpectations(t)
	})

	t.Run("stores loaded configuration", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{}
		p.API = api

		api.On("GetUnsanitizedConfig").Return(storedPluginConfig(map[string]interface{}{
			"WebhookSecret": "secret", "MaxEventsStored": "42", "MaxEventsDisplayed": "12", "TimelineOrder": "newest_first", "EnableReactions": true,
		}))

		require.NoError(t, p.OnConfigurationChange())
		cfg := p.getConfiguration()
		assert.Equal(t, "secret", cfg.WebhookSecret)
		assert.Equal(t, 42, cfg.maxEventsStoredInt())
		assert.Equal(t, 12, cfg.maxEventsDisplayedInt())
		assert.Equal(t, TimelineOrderNewestFirst, cfg.timelineOrder())
		assert.True(t, cfg.enableReactions())
		api.AssertExpectations(t)
	})

	t.Run("updates existing store max events", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{store: NewEventStore(api, 100)}
		p.API = api

		api.On("GetUnsanitizedConfig").Return(storedPluginConfig(map[string]interface{}{"MaxEventsStored": "7"}))

		require.NoError(t, p.OnConfigurationChange())
		assert.Equal(t, 7, p.store.maxEventsLimit())
		api.AssertExpectations(t)
	})
}

func TestOnActivateUsesLoadedConfiguration(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.API = api

	api.On("GetUnsanitizedConfig").Return(storedPluginConfig(map[string]interface{}{"MaxEventsStored": "11"}))

	require.NoError(t, p.OnConfigurationChange())
	require.NoError(t, p.OnActivate())
	require.NotNil(t, p.store)
	require.NotNil(t, p.router)
	assert.Equal(t, 11, p.store.maxEventsLimit())
	api.AssertExpectations(t)
}

func TestOnConfigurationChangeCanonicalValuesWin(t *testing.T) {
	for _, reversed := range []bool{false, true} {
		keys := []string{"EnableReactions", "enablereactions", "TimelineOrder", "timelineorder", "WebhookSecret", "webhooksecret", "MaxEventsStored", "maxeventsstored", "WebhookTokens", "webhooktokens"}
		values := []interface{}{true, false, "oldest_first", "newest_first", "old-secret", "", "500", "0", "[]", `[{"name":"sample","secret":"sample-secret"}]`}
		stored := make(map[string]interface{})
		for index := range keys {
			if reversed {
				index = len(keys) - 1 - index
			}
			stored[keys[index]] = values[index]
		}
		api := &plugintest.API{}
		p := &Plugin{}
		p.API = api
		api.On("GetUnsanitizedConfig").Return(storedPluginConfig(stored))
		for range 100 {
			require.NoError(t, p.OnConfigurationChange())
			cfg := p.getConfiguration()
			require.False(t, cfg.EnableReactions)
			require.Equal(t, "newest_first", cfg.TimelineOrder)
			require.Empty(t, cfg.WebhookSecret)
			require.Equal(t, "0", cfg.MaxEventsStored)
			require.Equal(t, values[9], cfg.WebhookTokens)
		}
		for index, key := range keys {
			require.Equal(t, values[index], stored[key])
		}
		api.AssertExpectations(t)
	}
}

func TestOnConfigurationChangeDefaults(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.API = api
	api.On("GetUnsanitizedConfig").Return(&model.Config{})
	require.NoError(t, p.OnConfigurationChange())
	require.Equal(t, &configuration{WebhookTokens: "[]", MaxEventsStored: "500", MaxEventsDisplayed: "100", TimelineOrder: "oldest_first", EnableReactions: true}, p.getConfiguration())
}

func TestOnConfigurationChangeKeyCompatibility(t *testing.T) {
	for _, test := range []struct {
		name     string
		settings map[string]interface{}
	}{
		{name: "canonical", settings: map[string]interface{}{"webhooksecret": "sample-secret", "enablereactions": false, "timelineorder": "newest_first"}},
		{name: "legacy", settings: map[string]interface{}{"WebhookSecret": "sample-secret", "EnableReactions": false, "TimelineOrder": "newest_first"}},
		{name: "multiple legacy aliases", settings: map[string]interface{}{"WEBHOOKSECRET": "obsolete-secret", "WebhookSecret": "sample-secret", "ENABLEREACTIONS": true, "EnableReactions": false, "TIMELINEORDER": "oldest_first", "TimelineOrder": "newest_first"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			api := &plugintest.API{}
			p := &Plugin{}
			p.API = api
			config := storedPluginConfig(test.settings)
			config.PluginSettings.Plugins["unrelated-plugin"] = map[string]interface{}{"ignored": func() {}}
			api.On("GetUnsanitizedConfig").Return(config)
			require.NoError(t, p.OnConfigurationChange())
			require.Equal(t, "sample-secret", p.getConfiguration().WebhookSecret)
			require.False(t, p.getConfiguration().EnableReactions)
			require.Equal(t, "newest_first", p.getConfiguration().TimelineOrder)
		})
	}
}

func TestOnConfigurationChangeRejectsInvalidValues(t *testing.T) {
	for _, value := range []interface{}{"false", func() {}} {
		api := &plugintest.API{}
		previous := &configuration{EnableReactions: true}
		p := &Plugin{configuration: previous}
		p.API = api
		api.On("GetUnsanitizedConfig").Return(storedPluginConfig(map[string]interface{}{"enablereactions": value}))
		require.Error(t, p.OnConfigurationChange())
		require.Same(t, previous, p.getConfiguration())
	}
}
