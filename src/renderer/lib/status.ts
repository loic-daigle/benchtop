import { STATUSES, type ProjectStatus } from '../../shared/types';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: 'Idea',
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  archived: 'Archived',
};

export { STATUSES };

/** Known link labels get a friendly name; anything else is shown as typed. */
export const LINK_PRESETS: Array<{ label: string; name: string; placeholder: string }> = [
  { label: 'github', name: 'GitHub', placeholder: 'https://github.com/…' },
  { label: 'easyeda', name: 'EasyEDA', placeholder: 'https://pro.easyeda.com/editor#id=…' },
  { label: 'youtube', name: 'YouTube', placeholder: 'https://youtu.be/…' },
  { label: 'makerworld', name: 'MakerWorld', placeholder: 'https://makerworld.com/…' },
  { label: 'jlc', name: 'JLC order', placeholder: 'https://cart.jlcpcb.com/…' },
  { label: 'hackaday', name: 'Hackaday', placeholder: 'https://hackaday.io/project/…' },
];

export function linkName(label: string): string {
  return LINK_PRESETS.find((p) => p.label === label.toLowerCase())?.name ?? label;
}
