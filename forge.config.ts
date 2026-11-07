import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Benchtop',
    executableName: 'Benchtop',
    // Forge picks icon.ico on Windows and icon.icns on macOS.
    icon: 'assets/icon',
    // The EasyEDA extension ships next to the app (built by `npm run build:easyeda`).
    extraResource: ['easyeda-extension/dist/benchtop-easyeda.eext'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'Benchtop', setupExe: 'Benchtop-Setup.exe', setupIcon: 'assets/icon.ico' }),
    new MakerZIP({}, ['darwin', 'linux']),
  ],
  // `npm run publish` uploads the installer to a GitHub release; installed copies update from there.
  publishers: [
    new PublisherGithub({
      repository: { owner: 'loic-daigle', name: 'benchtop' },
      draft: false, // the update service only sees published releases
      prerelease: false,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
