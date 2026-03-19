/**
 * Tests verifying static configuration files for Story 5.3:
 * - package.json has customUiPath (QA-5, Task 7.6)
 * - homebridge-ui/server.js exists (QA-6, Task 7.8)
 * - homebridge-ui/public/index.html exists (QA-7, Task 7.8)
 * - config.schema.json zone2.zoneId description matches AC 8 (QA-15, Task 7.7)
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');

describe('Story 5.3 — Static configuration verification', () => {
  // QA-5 / Task 7.6: package.json declares customUiPath
  it('QA-5: package.json contains "customUiPath": "homebridge-ui"', () => {
    const raw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { customUiPath?: string };
    expect(pkg.customUiPath).toBe('homebridge-ui');
  });

  // QA-6 / Task 7.8: homebridge-ui/server.js exists
  it('QA-6: homebridge-ui/server.js exists', () => {
    expect(fs.existsSync(path.join(repoRoot, 'homebridge-ui', 'server.js'))).toBe(true);
  });

  // QA-7 / Task 7.8: homebridge-ui/public/index.html exists
  it('QA-7: homebridge-ui/public/index.html exists', () => {
    expect(fs.existsSync(path.join(repoRoot, 'homebridge-ui', 'public', 'index.html'))).toBe(true);
  });

  // QA-15 / Task 7.7: config.schema.json zone2.zoneId description matches AC 8
  it('QA-15: config.schema.json zone2.zoneId description matches AC 8 text exactly', () => {
    const raw = fs.readFileSync(path.join(repoRoot, 'config.schema.json'), 'utf-8');
    const schema = JSON.parse(raw) as {
      schema: {
        properties: {
          zone2: {
            properties: {
              zoneId: { description: string };
            };
          };
        };
      };
    };
    expect(schema.schema.properties.zone2.properties.zoneId.description).toBe(
      'Zone ID from your StormAudio processor (set via the dropdown at the top of this page, or enter manually)',
    );
  });
});
