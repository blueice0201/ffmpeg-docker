import { describe, expect, it } from 'vitest';
import { buildScaleFilter, formatVerticalText, parseFfmpegProgressBlock, resolveDrawtextLayout } from './ffmpeg-utils';

describe('buildScaleFilter', () => {
  it('includes a safety crop before pad in contain mode', () => {
    expect(buildScaleFilter(240, 135, 'contain', '#000000')).toBe(
      'scale=240:135:force_original_aspect_ratio=decrease,crop=min(240\\,iw):min(135\\,ih),pad=240:135:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1'
    );
  });
});

describe('formatVerticalText', () => {
  it('stacks characters top to bottom', () => {
    expect(formatVerticalText('欢迎')).toBe('欢\n迎');
  });

  it('removes line breaks from source text', () => {
    expect(formatVerticalText('欢\n迎')).toBe('欢\n迎');
  });
});

describe('resolveDrawtextLayout', () => {
  it('places horizontal text at the top with margin', () => {
    expect(resolveDrawtextLayout({ text: '标题', position: 'top', margin: 24 })).toMatchObject({
      text: '标题',
      xExpr: '(w-text_w)/2',
      yExpr: '24',
      vertical: false
    });
  });

  it('places vertical text on the left', () => {
    expect(resolveDrawtextLayout({ text: '欢迎', position: 'left', margin: 30 })).toMatchObject({
      text: '欢\n迎',
      xExpr: '30',
      yExpr: '30',
      vertical: true
    });
  });

  it('places vertical text on the right', () => {
    expect(resolveDrawtextLayout({ text: '欢迎', position: 'right', margin: 20 })).toMatchObject({
      text: '欢\n迎',
      xExpr: '(w-text_w-20)',
      yExpr: '20',
      vertical: true
    });
  });
});

describe('parseFfmpegProgressBlock', () => {
  it('derives ratio from out_time_us and expected duration', () => {
    const block = [
      'frame=120',
      'out_time_us=5000000',
      'progress=continue'
    ].join('\n');

    expect(parseFfmpegProgressBlock(block, 10_000_000)).toBe(0.5);
  });

  it('returns 1 when progress ends', () => {
    const block = [
      'frame=300',
      'out_time_us=9900000',
      'progress=end'
    ].join('\n');

    expect(parseFfmpegProgressBlock(block, 10_000_000)).toBe(1);
  });

  it('falls back to out_time_ms when out_time_us is missing', () => {
    const block = [
      'frame=60',
      'out_time_ms=2500',
      'progress=continue'
    ].join('\n');

    expect(parseFfmpegProgressBlock(block, 10_000_000)).toBe(0.25);
  });
});
