import { productImage } from './product-images.js';
import { money } from './rules-client.js';

// 导出只包含顾客文案与所选款式，不包含会员编号、店主备注或经营数据。
export async function createMessageCard(message, product) {
    const canvas = document.createElement('canvas'),
        width = 900;
    const ctx = canvas.getContext('2d');
    ctx.font = '26px "Microsoft YaHei",sans-serif';
    const lines = [];
    let line = '';
    for (const char of message) {
        if (char === '\n') {
            lines.push(line);
            line = '';
            continue;
        }
        if (ctx.measureText(line + char).width > width - 100) {
            lines.push(line);
            line = char;
        } else line += char;
    }
    if (line) lines.push(line);
    const image = product ? productImage(product) : null;
    let photo = null;
    if (image) {
        photo = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('产品图读取失败，请稍后重试'));
            img.src = image.url;
        });
    }
    canvas.width = width;
    canvas.height = 180 + lines.length * 43 + (product ? 390 : 0);
    ctx.fillStyle = '#faf7f3';
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = '#71364d';
    ctx.font = 'italic 38px Georgia';
    ctx.fillText('Nailmate', 50, 65);
    ctx.fillStyle = '#392e34';
    ctx.font = '26px "Microsoft YaHei",sans-serif';
    lines.forEach((text, index) => ctx.fillText(text, 50, 125 + index * 43));
    if (product) {
        const y = 165 + lines.length * 43;
        if (photo) {
            const scale = Math.min(290 / photo.width, 290 / photo.height);
            ctx.drawImage(
                photo,
                50 + (290 - photo.width * scale) / 2,
                y,
                photo.width * scale,
                photo.height * scale,
            );
        }
        ctx.font = 'bold 25px "Microsoft YaHei",sans-serif';
        ctx.fillText(product.name, 370, y + 60);
        ctx.font = '22px "Microsoft YaHei",sans-serif';
        ctx.fillText(
            product.planned ? '演示预告 · ' + product.launchDate : money(product.price),
            370,
            y + 105,
        );
        if (image?.kind === 'generated_nail_swatch') {
            ctx.font = '17px "Microsoft YaHei",sans-serif';
            ctx.fillStyle = '#74666d';
            ctx.fillText('AI 甲片示意图 · 款式参考', 370, y + 150);
        }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图文卡片生成失败');
    const url = URL.createObjectURL(blob),
        link = document.createElement('a');
    link.href = url;
    link.download = 'NailMate-沟通卡片.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
