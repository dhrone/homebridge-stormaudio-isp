'use strict';

const { createRequire } = require('module');
const esmRequire = createRequire(require.resolve('@homebridge/plugin-ui-utils/package.json'));
const { HomebridgePluginUiServer } = esmRequire('./dist/server.js');
const { readZones } = require('./zonesHandler');
const { readPresets } = require('./presetsHandler');

class StormAudioUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/zones', () => readZones(this.homebridgeStoragePath));
    this.onRequest('/presets', () => readPresets(this.homebridgeStoragePath));
    this.ready();
  }
}

(() => new StormAudioUiServer())();
