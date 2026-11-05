import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const source = 'C:/Users/DAVID/.dsh/attachments/v1/objects/c5/c509d7e0bc52503d05060cde4b742768b119696aad55dc8b3a40c9d8ad3cfc6e';
const dest = name => fileURLToPath(new URL('../public/'+name,import.meta.url));
console.log(await sharp(source).metadata());
await sharp(source).png({compressionLevel:9}).toFile(dest('logo.png'));
await sharp(source).resize(48,48).png().toFile(dest('favicon.png'));
await sharp(source).flatten({background:'#fffefa'}).png().toFile(fileURLToPath(new URL('../verification/logo-on-paper.png',import.meta.url)));
console.log('Logo PNG and favicon prepared');
