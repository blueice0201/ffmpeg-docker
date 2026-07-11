export const COMPOSE_FONT_IDS = ['noto-sans-sc', 'noto-sans-tc', 'noto-serif-sc'] as const;

export type ComposeFontId = (typeof COMPOSE_FONT_IDS)[number];

export const DEFAULT_COMPOSE_FONT_ID: ComposeFontId = 'noto-sans-sc';

export interface ComposeFontDefinition {
  id: ComposeFontId;
  label: string;
  fileName: string;
  downloadUrls: string[];
}

const NOTO_CJK_GH = 'https://github.com/notofonts/noto-cjk/raw';
const NOTO_CJK_CDN = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk';

export const COMPOSE_FONTS: readonly ComposeFontDefinition[] = [
  {
    id: 'noto-sans-sc',
    label: '思源黑体（简体）',
    fileName: 'NotoSansSC-Regular.otf',
    downloadUrls: [
      `${NOTO_CJK_GH}/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`,
      `${NOTO_CJK_CDN}@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`
    ]
  },
  {
    id: 'noto-sans-tc',
    label: '思源黑体（繁体）',
    fileName: 'NotoSansTC-Regular.otf',
    downloadUrls: [
      `${NOTO_CJK_GH}/Sans2.004/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf`,
      `${NOTO_CJK_CDN}@Sans2.004/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf`
    ]
  },
  {
    id: 'noto-serif-sc',
    label: '思源宋体（简体）',
    fileName: 'NotoSerifSC-Regular.otf',
    downloadUrls: [
      `${NOTO_CJK_GH}/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf`,
      `${NOTO_CJK_CDN}@Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf`
    ]
  }
] as const;

export function getComposeFontDefinition(fontId?: string): ComposeFontDefinition {
  const match = COMPOSE_FONTS.find((font) => font.id === fontId);
  const fallback = COMPOSE_FONTS.find((font) => font.id === DEFAULT_COMPOSE_FONT_ID);
  if (!fallback) {
    throw new Error('No compose fonts configured');
  }
  return match ?? fallback;
}
