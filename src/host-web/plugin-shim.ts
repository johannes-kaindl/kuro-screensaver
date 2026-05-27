// Plugin-shaped wrapper around WebHost — bridges the legacy controller
// (which expects a Plugin instance with settings tree + saveData) to the
// standalone WebHost (localStorage persistence). The settings object is a
// live reference: controller mutations in-place persist on the next
// saveData() call.

import type { WebHost } from './persistence';
import type { HostPlugin } from '../engine/controller';

export function makePluginShim(host: WebHost): HostPlugin {
  const settings = {
    screensaver: host.getSettings(),
    activePreset: host.getActivePreset(),
    vaultKanji: host.getVaultKanji(),
    vaultKanjiCustom: '',
  };
  return {
    settings,
    async saveData(_data: any): Promise<void> {
      host.saveSettings(settings.screensaver);
    },
    app: { workspace: { getActiveFile: () => null } },
  };
}
