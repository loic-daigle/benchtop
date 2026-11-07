export type FileCategory = 'code' | 'pcb' | 'cad' | 'image' | 'doc' | 'media' | 'archive' | 'other';

export interface CategoryCounts {
  code: number;
  pcb: number;
  cad: number;
  image: number;
  doc: number;
  media: number;
  archive: number;
  other: number;
}

export const STATUSES = ['idea', 'active', 'paused', 'done', 'archived'] as const;
export type ProjectStatus = (typeof STATUSES)[number];

export interface ProjectLink {
  label: string;
  url: string;
}

/** Contents of a project's project.yaml (all optional). */
export interface ProjectMeta {
  status?: ProjectStatus;
  description?: string;
  tags?: string[];
  /** Cover image, relative to the project folder. */
  cover?: string;
  links?: ProjectLink[];
  /** This folder is a container: each sub-folder is its own project. */
  group?: boolean;
  /** Names of the EasyEDA projects that belong to this project. */
  easyeda?: string[];
}

export interface GitInfo {
  branch: string | null;
  ahead: number;
  behind: number;
  /** Number of changed / untracked files. */
  changes: number;
  lastCommit: { subject: string; date: number; hash: string } | null;
  remoteUrl: string | null;
  /** https:// link to the repo page when the remote is GitHub/GitLab/etc. */
  webUrl: string | null;
}

export interface ProjectSummary {
  name: string;
  path: string;
  /** Name of the group folder this project lives in (e.g. "Software"), if any. */
  group: string | null;
  /** Most recent modification time found in the project (ms since epoch). */
  modified: number;
  /** project.yaml description, else first paragraph of the README. */
  description: string | null;
  readmePath: string | null;
  notesPath: string | null;
  thumbnailPath: string | null;
  meta: ProjectMeta;
  metaError: string | null;
  /** The project folder itself is a git repository. */
  isGitRepo: boolean;
  /** A git repository exists somewhere inside the project (not at its root). */
  containsGitRepo: boolean;
  git: GitInfo | null;
  counts: CategoryCounts;
  fileCount: number;
  /** The scan stopped early because the project is very large. */
  partial: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  /** Dependency / build-output folder: shown dimmed and never scanned. */
  heavy: boolean;
}

export type TextResult =
  | { kind: 'text'; content: string; truncated: boolean; encoding: string }
  | { kind: 'binary' }
  | { kind: 'error'; message: string };

export interface Settings {
  root: string | null;
  pinned: string[];
  /** Most recently opened project paths, newest first. */
  recent: string[];
}

export interface QuickFindItem {
  kind: 'project' | 'file';
  projectPath: string;
  projectName: string;
  /** Absolute path (same as projectPath for projects). */
  path: string;
  /** Path relative to the project, for files. */
  relPath: string;
  score: number;
}

export interface SearchMatch {
  line: number;
  text: string;
  /** Character offset of the match in `text`. */
  col: number;
}

export interface SearchFileResult {
  projectPath: string;
  projectName: string;
  path: string;
  relPath: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  results: SearchFileResult[];
  filesSearched: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface FsChange {
  /** Project whose files changed. */
  projectPath: string;
  /** Folder (absolute) that changed, when known. */
  dir: string | null;
}

export interface BenchtopApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Pick<Settings, 'pinned' | 'recent'>>): Promise<Settings>;
  chooseRoot(): Promise<string | null>;
  /** Returns cached projects immediately (if any) and refreshes in the background. */
  listProjects(): Promise<ProjectSummary[]>;
  rescan(): Promise<ProjectSummary[]>;
  onProjectsUpdated(cb: (projects: ProjectSummary[]) => void): () => void;
  onFsChanged(cb: (change: FsChange) => void): () => void;
  listDir(dirPath: string): Promise<DirEntry[]>;
  readText(filePath: string): Promise<TextResult>;
  saveMeta(projectPath: string, meta: ProjectMeta): Promise<ProjectSummary>;
  saveNotes(projectPath: string, content: string): Promise<void>;
  readNotes(projectPath: string): Promise<string>;
  quickFind(query: string): Promise<QuickFindItem[]>;
  search(query: string, opts?: { projectPath?: string; caseSensitive?: boolean }): Promise<SearchResponse>;
  openPath(targetPath: string): Promise<void>;
  showInFolder(targetPath: string): Promise<void>;
  openInEditor(targetPath: string): Promise<void>;
  openTerminal(dirPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  // New project / structure
  createProject(input: NewProjectInput): Promise<string>;
  planStructure(projectPath: string): Promise<StructurePlan>;
  applyStructure(projectPath: string, moves: MoveItem[]): Promise<ApplyResult>;
  canUndoStructure(projectPath: string): Promise<boolean>;
  undoStructure(projectPath: string): Promise<ApplyResult>;
  /** Mark a folder as a group of projects (true) or a single project (false). */
  setGroup(folderPath: string, isGroup: boolean): Promise<void>;

  // EasyEDA
  easyedaStatus(refresh?: boolean): Promise<EasyEdaStatus>;
  easyedaSuggest(): Promise<Record<string, string | null>>;
  easyedaLink(links: Record<string, string[]>): Promise<void>;
  fabFiles(projectPath: string): Promise<FabFile[]>;
  copyEasyEdaBackup(projectPath: string, easyedaName: string): Promise<string>;
  openEasyEda(projectPath: string): Promise<void>;
  /** The local connection used by the Benchtop extension inside EasyEDA. */
  easyedaBridgeInfo(): Promise<BridgeInfo>;
  easyedaNewPairingCode(): Promise<BridgeInfo>;
  easyedaRestartBridge(): Promise<BridgeInfo>;
  easyedaShowExtension(): Promise<void>;
  onEasyEdaBridge(cb: (info: BridgeInfo) => void): () => void;
  onEasyEdaExported(cb: (e: EasyEdaExported) => void): () => void;
  /** EasyEDA asked to show a project. */
  onNavigate(cb: (e: { projectPath: string }) => void): () => void;
  copyText(text: string): Promise<void>;
  /** Board images (top and bottom) from a Gerber zip. */
  renderGerber(zipPath: string): Promise<GerberRender>;
  zipInfo(zipPath: string): Promise<ZipInfo>;
  readBinary(filePath: string): Promise<Uint8Array>;

  // Releases
  releases(projectPath: string): Promise<ReleasesResult>;
  createRelease(projectPath: string, input: NewReleaseInput): Promise<Release>;
  saveRelease(projectPath: string, relDir: string, info: ReleaseInfo): Promise<void>;
  /** Record the current firmware commit in a release. */
  snapshotFirmware(projectPath: string, relDir: string): Promise<ReleaseFirmware | null>;
  /** A .wasm file bundled with the app (packaged builds). */
  appAsset(name: string): Promise<Uint8Array>;

  // GitHub
  githubStatus(): Promise<GitHubStatus>;
  githubSetToken(token: string): Promise<GitHubStatus>;
  githubUseCli(): Promise<GitHubStatus>;
  githubSignOut(): Promise<GitHubStatus>;
  publishPrecheck(projectPath: string): Promise<PublishPrecheck>;
  publish(projectPath: string, opts: PublishOptions): Promise<PublishResult>;
  onPublishProgress(cb: (message: string) => void): () => void;
  gitChanges(projectPath: string): Promise<GitChange[]>;
  commitAndPush(projectPath: string, message: string): Promise<string>;
  pull(projectPath: string): Promise<string>;

  platform: string;
}

// ---------------------------------------------------------------- New project / structure

export type ProjectKind = 'hardware' | 'firmware' | 'software';

export interface NewProjectInput {
  /** Display name, e.g. "Smart Dial". */
  name: string;
  /** Folder name on disk, e.g. "smart-dial". */
  folderName: string;
  /** Absolute folder to create it in (projects root or a group folder). */
  parentDir: string;
  kind: ProjectKind;
  status?: ProjectStatus;
  description?: string;
  tags?: string[];
  gitInit: boolean;
}

export interface MoveItem {
  /** Absolute paths. */
  from: string;
  to: string;
  isDir: boolean;
  reason: string;
  /** Folders to remove after this move if they ended up empty (merged "Software/" etc.). */
  cleanup?: string[];
}

export interface StructurePlan {
  projectPath: string;
  kind: ProjectKind | 'unknown';
  moves: MoveItem[];
  /** Entries left where they are, with the reason. */
  kept: Array<{ path: string; reason: string }>;
  warnings: string[];
}

export interface ApplyResult {
  done: MoveItem[];
  failed: Array<{ item: MoveItem; error: string }>;
}

// ---------------------------------------------------------------- GitHub

export interface GitHubAccount {
  login: string;
  name: string | null;
  avatarUrl: string;
  source: 'token' | 'gh-cli';
}

export interface GitHubStatus {
  account: GitHubAccount | null;
  ghCliAvailable: boolean;
  gitAvailable: boolean;
  lfsAvailable: boolean;
}

export interface SecretHit {
  relPath: string;
  line: number;
  text: string;
}

export interface PublishPrecheck {
  isRepo: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  fileCount: number;
  totalBytes: number;
  /** > 50 MB */
  largeFiles: Array<{ relPath: string; size: number }>;
  /** Files GitHub would refuse (> 100 MB) and that LFS would not cover. */
  blockedFiles: Array<{ relPath: string; size: number }>;
  cadFileCount: number;
  secrets: SecretHit[];
  /** Sub-folders that are their own git repo (relative). */
  nestedRepos: string[];
  hasGitignore: boolean;
  suggestedName: string;
}

export interface PublishOptions {
  repoName: string;
  description: string;
  isPrivate: boolean;
  useLfs: boolean;
  /** Relative paths to add to .gitignore before the first commit. */
  exclude: string[];
  commitMessage: string;
}

export interface PublishResult {
  url: string;
}

export interface GitChange {
  status: string;
  path: string;
}

// ---------------------------------------------------------------- EasyEDA

export interface EasyEdaBackup {
  file: string;
  path: string;
  /** From the file name when possible, else the file date. */
  date: number;
  version: number | null;
  size: number;
}

export interface EasyEdaProject {
  name: string;
  uuid: string | null;
  /** Backup folders (a project can have more than one). */
  folders: string[];
  backups: number;
  latest: EasyEdaBackup | null;
  /** Local project file (offline mode), if any. */
  eprj: string | null;
}

export interface EasyEdaStatus {
  found: boolean;
  dataDir: string | null;
  /** "ONLINE", "HALF_OFFLINE", "OFFLINE"… as written by the client. */
  mode: string | null;
  backupDir: string | null;
  projects: EasyEdaProject[];
}

export type FabKind = 'gerber' | 'bom' | 'pnp' | 'schematic' | 'source' | 'step';

export interface FabFile {
  kind: FabKind;
  name: string;
  path: string;
  relPath: string;
  date: number;
  size: number;
}

// ---------------------------------------------------------------- EasyEDA extension bridge

export interface BridgeInfo {
  listening: boolean;
  port: number;
  /** Extensions connected right now. */
  clients: number;
  error: string | null;
  lastSeen: number | null;
  extensionVersion: string | null;
  /** Pairing code to paste in EasyEDA (Benchtop → Connect to Benchtop…). */
  code: string;
  /** The .eext to import in EasyEDA's Extension Manager, if it ships with this build. */
  extensionFile: string | null;
}

export interface EasyEdaExported {
  projectPath: string;
  relDir: string;
  written: string[];
  failed: Array<{ kind: string; error: string }>;
}

// ---------------------------------------------------------------- Board and 3D previews

export interface GerberRender {
  /** SVG of the top side, as seen from above. */
  top: string;
  /** SVG of the bottom side, mirrored as seen from below. */
  bottom: string;
  width: number | null;
  height: number | null;
  units: 'mm' | 'in';
  /** False when the board outline couldn't be closed and the board is drawn as a rectangle. */
  outline: boolean;
  layers: Array<{ name: string; type: string; side: string | null }>;
  /** Files in the zip that aren't a known layer. */
  skipped: string[];
}

// ---------------------------------------------------------------- Releases

export const RELEASE_STATUSES = ['planned', 'ordered', 'received', 'assembled', 'retired'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** What's written in releases/<name>/release.yaml. */
export interface ReleaseInfo {
  /** YYYY-MM-DD */
  date: string;
  /** Board revision, e.g. "rev B" or "v1.2". */
  board: string;
  status: ReleaseStatus | '';
  /** Manufacturer order number. */
  order: string;
  /** Order page, tracking, or anything else. */
  link: string;
  note: string;
  /** The firmware version that goes with this board. */
  firmware: ReleaseFirmware | null;
}

export interface ReleaseFirmware {
  commit: string;
  branch: string | null;
  /** Git repository, relative to the project ("" = the project itself). */
  repo: string;
  /** Uncommitted changes when the snapshot was taken. */
  dirty: boolean;
  /** Commit subject, for display. */
  subject: string | null;
}

export interface ReleaseFile {
  name: string;
  path: string;
  relPath: string;
  kind: FabKind | null;
  size: number;
}

export interface Release {
  /** Folder name, e.g. 2026-11-06 */
  name: string;
  path: string;
  /** Relative to the project, e.g. releases/2026-11-06 */
  relDir: string;
  info: ReleaseInfo;
  /** False when there's no release.yaml yet (info is guessed from the folder). */
  hasInfo: boolean;
  infoError: string | null;
  files: ReleaseFile[];
}

export interface FirmwareState {
  /** Git repository holding the firmware, relative to the project; null when there is none. */
  repo: string | null;
  head: string | null;
  branch: string | null;
  subject: string | null;
  dirty: boolean;
  /** The release the current firmware is based on (same commit, or the closest one before). */
  match: { release: string; commitsSince: number } | null;
  /** Per release: commits between that release's firmware and now (null = unknown / not an ancestor). */
  since: Record<string, number | null>;
}

export interface ReleasesResult {
  releases: Release[];
  firmware: FirmwareState;
  /** Latest fabrication files outside releases/ (offered when creating a release). */
  latestFab: Partial<Record<FabKind, FabFile>>;
}

export interface NewReleaseInput {
  name: string;
  info: Omit<ReleaseInfo, 'firmware'>;
  /** Copy the newest Gerber/BOM/pick & place/... from the project into the release. */
  copyKinds: FabKind[];
  recordFirmware: boolean;
}

export interface ZipInfo {
  entries: Array<{ name: string; size: number }>;
  /** Contains Gerber layers (at least one copper layer). */
  gerber: boolean;
  tooLarge: boolean;
}
