# Benchtop for EasyEDA Pro

Adds a **Benchtop** menu to EasyEDA Pro (v3) in the home page, schematic and PCB editors.

- **Export to Benchtop…** makes the Gerber zip, BOM (csv), pick & place (csv), schematic PDF, 3D STEP and
  the `.epro` project file, and saves them in the linked Benchtop project, either in its `pcb/` folder or
  in `releases/<date>/` for an order. Existing files are never overwritten.
- **Open in Benchtop** brings Benchtop to the front on that project.
- **Link to a Benchtop project…** changes which project this board belongs to (saved in its `project.yaml`).
- **Connect to Benchtop…** enter the pairing code shown in Benchtop.

## Install

1. EasyEDA: Settings → Extensions → Extension Manager → Import → `benchtop-easyeda.eext`.
2. Click *Benchtop* in the list → *Config* tab → tick **Allow external interaction**.
3. Benchtop menu → *Connect to Benchtop…* → paste the code from Benchtop (chip icon on the dashboard).

Benchtop must be running. The extension only talks to `ws://127.0.0.1:47652` on this computer.

## Build

`npm run build:easyeda` in the Benchtop folder. Bump `version` in `extension.json` before re-importing:
EasyEDA ignores an import with the same version.
