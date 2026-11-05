import { createWriteStream, readFileSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';

/**
 * Minimal ZIP writer that puts CRC and both sizes in the local header.
 *
 * fflate's streaming `Zip`/`ZipDeflate` always writes a trailing data descriptor
 * (general purpose flag bit 3), and Windows Explorer's built-in zip folder then
 * fails with 0x80004005 on some entries ("一个意外错误使您无法复制该文件").
 * Sizes are known up front here, so we write them directly and keep bit 3 clear.
 */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

const crc32 = buffer => {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};

const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const localHeader = ({ name, method, crc, compressed, size }) => {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer]);
};

const centralHeader = ({ name, method, crc, compressed, size, offset, directory }) => {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(directory ? 0x10 : 0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBuffer]);
};

/**
 * @param {string} outputPath
 * @param {Array<{ name: string, file?: string, data?: Buffer }>} entries
 * @param {{ level?: number }} [options]
 */
export const writeZip = (outputPath, entries, { level = 9 } = {}) => {
  const stream = createWriteStream(outputPath);
  const chunks = [];
  let offset = 0;
  let pending = Promise.resolve();

  const emit = buffer => new Promise((resolve, reject) => {
    offset += buffer.length;
    if (stream.write(buffer)) resolve();
    else stream.once('drain', resolve).once('error', reject);
  });

  const directories = new Set();
  for (const entry of entries) {
    const parts = entry.name.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(`${parts.slice(0, i).join('/')}/`);
    if (entry.name.endsWith('/')) directories.delete(entry.name);
  }

  const central = [];
  const addEntry = async entry => {
    const isDirectory = entry.name.endsWith('/');
    const raw = isDirectory ? Buffer.alloc(0) : entry.data ?? readFileSync(entry.file);
    const compressed = isDirectory ? raw : deflateRawSync(raw, { level });
    const payload = { name: entry.name, method: isDirectory ? 0 : 8, crc: crc32(raw), compressed: compressed.length, size: raw.length, offset, directory: isDirectory };
    await emit(localHeader(payload));
    if (!isDirectory) await emit(compressed);
    central.push(payload);
  };

  for (const name of [...directories].sort()) pending = pending.then(() => addEntry({ name }));
  for (const entry of entries) {
    if (entry.name.endsWith('/')) pending = pending.then(() => addEntry(entry));
    else pending = pending.then(() => addEntry(entry));
  }

  return pending.then(async () => {
    const directoryOffset = offset;
    for (const payload of central) await emit(centralHeader(payload));
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    end.writeUInt16LE(0, 20);
    await emit(end);
    await new Promise((resolve, reject) => stream.end(resolve).once('error', reject));
    return { entries: central.length, bytes: offset };
  });
};

export const collectFiles = (root, { prefix = '' } = {}) => {
  const walk = (directory, relative, out) => {
    for (const name of readdirSyncOrdered(directory)) {
      const absolute = path.join(directory, name);
      const inside = relative ? `${relative}/${name}` : name;
      if (statSync(absolute).isDirectory()) walk(absolute, inside, out);
      else out.push({ name: `${prefix}${inside}`, file: absolute });
    }
    return out;
  };
  return walk(root, '', []);
};

import { readdirSync } from 'node:fs';
export const readdirSyncOrdered = directory => readdirSync(directory).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
