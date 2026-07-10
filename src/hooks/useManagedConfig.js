import { useEffect, useState } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';

const { ManagedConfig } = NativeModules;
const emitter = new NativeEventEmitter(ManagedConfig);

// Fleet defaults — used until MDM config arrives, and as per-key fallback.
export const DEFAULT_CONFIG = {
  wms_url: 'https://operations.octane.store',
  battery_amber_pct: 25,
  battery_red_pct: 15,
  refresh_button_enabled: true,
  camera_id: '0',
  kb_jiggle_enabled: true,
};

/**
 * Live managed configuration from Headwind MDM.
 * Re-renders automatically when the panel config changes (MQTT push →
 * launcher sync → setApplicationRestrictions → change broadcast → here).
 */
export function useManagedConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    let mounted = true;

    const apply = (raw) => {
      if (!mounted) return;
      // Empty bundle means "no config pushed yet" — keep defaults.
      if (raw && Object.keys(raw).length > 0) {
        setConfig({ ...DEFAULT_CONFIG, ...raw });
      }
    };

    ManagedConfig.getConfig().then(apply).catch(() => {});
    const sub = emitter.addListener('managedConfigChanged', apply);

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return config;
}
