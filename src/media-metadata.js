// 读取音视频文件内嵌的标签与歌词（不依赖第三方库）：
//   · MP4 / M4V / M4A / MOV：moov → udta → meta → ilst 里的 ©nam / ©ART / ©alb / ©lyr
//   · MP3：ID3v2.3 / v2.4 的 TIT2 / TPE1 / TALB / USLT
// 返回 { title, artist, album, lyrics }，读不到返回 null；任何异常都不抛出。
// 只按需读取文件片段（Atom 头 / ID3 标签区），不会把整首歌读进内存。

const decoder = new TextDecoder('utf-8', { fatal: false });

function u16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}
function u32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}
function ascii(bytes, offset, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const code = bytes[offset + i];
    if (code === undefined) break;
    text += String.fromCharCode(code);
  }
  return text;
}

async function sliceBytes(file, start, end) {
  const clampedEnd = Math.min(end, file.size);
  if (clampedEnd <= start) return new Uint8Array(0);
  const buffer = await file.slice(start, clampedEnd).arrayBuffer();
  return new Uint8Array(buffer);
}

/** 解析一段字节里的 MP4 box 列表（不递归）。 */
function listBoxes(bytes, start = 0, end = bytes.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(BigInt(u32(bytes, offset + 8)) << 32n | BigInt(u32(bytes, offset + 12)));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, end: offset + size, payloadStart: offset + headerSize });
    offset += size;
  }
  return boxes;
}

/** 在 ilst 里取 data box 的文本值。 */
function readIlstValue(bytes, payloadStart, boxEnd) {
  const boxes = listBoxes(bytes, payloadStart, boxEnd);
  const dataBox = boxes.find((box) => box.type === 'data');
  if (!dataBox) return '';
  // data box：4 字节类型/版本 + 4 字节 locale + 文本
  const valueStart = dataBox.payloadStart + 8;
  if (valueStart >= dataBox.end) return '';
  return decoder.decode(bytes.subarray(valueStart, dataBox.end)).replace(/\0+$/, '').trim();
}

async function readMp4(file) {
  const tags = {};
  // 顶层 box 逐个读头，找到 moov（moov 可能在文件尾部，不能只读开头）。
  let offset = 0;
  let moov = null;
  let guard = 0;
  while (offset + 8 <= file.size && guard < 64) {
    guard += 1;
    const header = await sliceBytes(file, offset, offset + 16);
    if (header.length < 8) break;
    let size = u32(header, 0);
    const type = ascii(header, 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) break;
      size = Number(BigInt(u32(header, 8)) << 32n | BigInt(u32(header, 12)));
      headerSize = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (size < headerSize) break;
    if (type === 'moov') {
      // 记录的是文件偏移；后面按切片解析时要换算成切片内偏移（moov 头长度）。
      moov = { start: offset, headerSize, size };
      break;
    }
    offset += size;
  }
  if (!moov) return null;
  // moov 一般只有几十 KB，限制上限防止异常文件把内存打爆。
  if (moov.size > 16 * 1024 * 1024) return null;
  const bytes = await sliceBytes(file, moov.start, moov.start + moov.size);
  if (bytes.length < moov.size) return null;

  const visit = (parent, depth = 0) => {
    if (depth > 6) return;
    for (const box of listBoxes(bytes, parent.payloadStart, parent.end)) {
      if (box.type === 'udta' || box.type === 'trak' || box.type === 'moov') {
        visit(box, depth + 1);
      } else if (box.type === 'meta') {
        // meta 是 full box：先跳过 4 字节 version/flags
        visit({ ...box, payloadStart: box.payloadStart + 4 }, depth + 1);
      } else if (box.type === 'ilst') {
        for (const entry of listBoxes(bytes, box.payloadStart, box.end)) {
          if (entry.type === '©nam') tags.title = readIlstValue(bytes, entry.payloadStart, entry.end);
          else if (entry.type === '©ART') tags.artist = readIlstValue(bytes, entry.payloadStart, entry.end);
          else if (entry.type === 'aART' && !tags.artist) tags.artist = readIlstValue(bytes, entry.payloadStart, entry.end);
          else if (entry.type === '©alb') tags.album = readIlstValue(bytes, entry.payloadStart, entry.end);
          else if (entry.type === '©lyr') tags.lyrics = readIlstValue(bytes, entry.payloadStart, entry.end);
        }
      }
    }
  };
  visit({ payloadStart: moov.headerSize, end: bytes.length });
  return Object.keys(tags).length ? tags : null;
}

function decodeId3Text(bytes, offset, length, encoding) {
  const slice = bytes.subarray(offset, offset + length);
  if (!slice.length) return '';
  if (encoding === 1 || encoding === 2) {
    // UTF-16（带 BOM 或 BE）
    let copy = slice;
    if (encoding === 2) {
      copy = new Uint8Array(slice.length + 2);
      copy[0] = 0xfe;
      copy[1] = 0xff;
      copy.set(slice, 2);
    }
    return new TextDecoder('utf-16').decode(copy).replace(/\0+$/, '').trim();
  }
  if (encoding === 3) return decoder.decode(slice).replace(/\0+$/, '').trim();
  // latin1
  let text = '';
  for (const byte of slice) text += String.fromCharCode(byte);
  return text.replace(/\0+$/, '').trim();
}

async function readId3(file) {
  const head = await sliceBytes(file, 0, 10);
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return null;
  const major = head[3];
  if (major !== 3 && major !== 4 && major !== 2) return null;
  const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
  if (size <= 0 || size > 8 * 1024 * 1024) return null;
  const bytes = await sliceBytes(file, 0, 10 + size + 10);
  if (bytes.length < 10 + size) return null;
  const tags = {};
  let offset = 10;
  const end = 10 + size;
  // ID3v2.2 帧头 6 字节，v2.3/2.4 为 10 字节
  const frameHeaderSize = major === 2 ? 6 : 10;
  while (offset + frameHeaderSize <= end) {
    const id = ascii(bytes, offset, major === 2 ? 3 : 4);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let frameSize;
    if (major === 2) {
      frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
    } else if (major === 4) {
      // v2.4 帧长度为 syncsafe
      frameSize =
        ((bytes[offset + 4] & 0x7f) << 21) |
        ((bytes[offset + 5] & 0x7f) << 14) |
        ((bytes[offset + 6] & 0x7f) << 7) |
        (bytes[offset + 7] & 0x7f);
    } else {
      frameSize = u32(bytes, offset + 4);
    }
    if (frameSize <= 0 || offset + frameHeaderSize + frameSize > end) break;
    const bodyStart = offset + frameHeaderSize;
    const bodyEnd = bodyStart + frameSize;
    const encoding = bytes[bodyStart];
    if (id === 'TIT2' || id === 'TT2') tags.title = decodeId3Text(bytes, bodyStart + 1, frameSize - 1, encoding);
    else if (id === 'TPE1' || id === 'TP1') tags.artist = decodeId3Text(bytes, bodyStart + 1, frameSize - 1, encoding);
    else if (id === 'TALB' || id === 'TAL') tags.album = decodeId3Text(bytes, bodyStart + 1, frameSize - 1, encoding);
    else if (id === 'USLT' || id === 'ULT') {
      // 编码(1) + 语言(3) + 内容描述(以 0 结尾) + 歌词
      let cursor = bodyStart + 4;
      const wide = encoding === 1 || encoding === 2;
      if (wide) {
        while (cursor + 1 < bodyEnd && !(bytes[cursor] === 0 && bytes[cursor + 1] === 0)) cursor += 2;
        cursor += 2;
      } else {
        while (cursor < bodyEnd && bytes[cursor] !== 0) cursor += 1;
        cursor += 1;
      }
      tags.lyrics = decodeId3Text(bytes, cursor, bodyEnd - cursor, encoding);
    }
    offset = bodyEnd;
  }
  return Object.keys(tags).length ? tags : null;
}

/**
 * 读取音视频文件的内嵌标签（标题 / 歌手 / 专辑 / 歌词）。
 * @param {File|Blob & {name?: string, type?: string, size: number, slice: Function}} file
 * @returns {Promise<{title?: string, artist?: string, album?: string, lyrics?: string}|null>}
 */
export async function readMediaMetadata(file) {
  if (!file || typeof file.slice !== 'function' || !file.size) return null;
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const isMp4 = /\.(mp4|m4a|m4v|m4b|mov)$/.test(name) || /^video\/(mp4|quicktime|x-m4v)$/.test(type) || /^audio\/(mp4|x-m4a)$/.test(type);
  const isMp3 = /\.mp3$/.test(name) || type === 'audio/mpeg' || type === 'audio/mp3';
  try {
    if (isMp4) return await readMp4(file);
    if (isMp3) return await readId3(file);
    // 未知类型：先按 ID3 试，再按 MP4 试
    return (await readId3(file)) || (await readMp4(file));
  } catch {
    return null;
  }
}

/** 内嵌歌词是否是可用的 LRC（至少两行时间轴）。 */
export function isValidEmbeddedLyrics(text) {
  if (typeof text !== 'string') return false;
  const hits = text.match(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g);
  return Boolean(hits && hits.length >= 2);
}
