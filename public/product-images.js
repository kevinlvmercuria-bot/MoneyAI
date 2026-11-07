// 只读取附件自带示意图；门店上传图优先，未调用图片生成接口。
const references = {
    P001: {
        name: '奶油裸色微法式',
        url: '/assets/relationship-products/P001.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P002: {
        name: '黑曜极细法式',
        url: '/assets/relationship-products/P002.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P003: {
        name: '莓果双层法式',
        url: '/assets/relationship-products/P003.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P004: {
        name: '燕麦裸色纯色',
        url: '/assets/relationship-products/P004.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P005: {
        name: '蜜桃裸色渐变',
        url: '/assets/relationship-products/P005.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P006: {
        name: '水光豆沙裸色',
        url: '/assets/relationship-products/P006.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P007: {
        name: '红茶猫眼',
        url: '/assets/relationship-products/P007.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P008: {
        name: '雾紫丝绒猫眼',
        url: '/assets/relationship-products/P008.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P009: {
        name: '香槟碎钻猫眼',
        url: '/assets/relationship-products/P009.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P010: {
        name: '日落蜜桃渐变',
        url: '/assets/relationship-products/P010.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P011: {
        name: '灰蓝云雾渐变',
        url: '/assets/relationship-products/P011.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P012: {
        name: '焦糖拿铁渐变',
        url: '/assets/relationship-products/P012.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P013: {
        name: '水光蜜桃粉',
        url: '/assets/relationship-products/P013.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P014: {
        name: '豆沙云雾纯色',
        url: '/assets/relationship-products/P014.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P015: {
        name: '冷调车厘子红',
        url: '/assets/relationship-products/P015.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P016: {
        name: '新中式黛青描金',
        url: '/assets/relationship-products/P016.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P017: {
        name: '朱砂花影新中式',
        url: '/assets/relationship-products/P017.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P018: {
        name: '青瓷水墨新中式',
        url: '/assets/relationship-products/P018.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
    P019: {
        name: '基础甲周护理',
        url: '/assets/relationship-products/P019.webp',
        kind: 'reference',
        sourceUrl: 'https://blueskycosmetics.co.uk/blogs/blog/the-perfect-prescriptive-manicure',
    },
    P020: {
        name: '深层手部 SPA 护理',
        url: '/assets/relationship-products/P020.webp',
        kind: 'reference',
        sourceUrl: 'https://medazur.md/en/procedure/120/spa_manicure_with_a_hand-to-elbow_massage',
    },
    P021: {
        name: '甲面修护加固',
        url: '/assets/relationship-products/P021.webp',
        kind: 'reference',
        sourceUrl:
            'https://nailsami.com/blogs/guides/builder-gel-nails-complete-guide-to-natural-nail-overlays',
    },
    P022: {
        name: '温和卸甲护理',
        url: '/assets/relationship-products/P022.webp',
        kind: 'reference',
        sourceUrl:
            'https://delanes-natural-nail-care.ueniweb.com/services/nail-add-ons/gel-polish-removal-150366245',
    },
    P023: {
        name: '单指补甲修护',
        url: '/assets/relationship-products/P023.webp',
        kind: 'reference',
        sourceUrl: 'https://www.nailquick.co.jp/article/p-20151027-1/',
    },
    P024: {
        name: '居家甲缘护理油',
        url: '/assets/relationship-products/P024.webp',
        kind: 'reference',
        sourceUrl: 'https://sienna.co/blogs/news/our-tips-for-strong-beautiful-nails',
    },
    'IDEA-SEA-SALT': {
        name: '海盐冰气泡',
        url: '/assets/relationship-products/IDEA-SEA-SALT.webp',
        kind: 'generated_nail_swatch',
        sourceUrl: null,
    },
};
export function productImage(product) {
    if (product.imageUrl) return { url: product.imageUrl, reference: false, kind: 'uploaded' };
    const image = references[product.id];
    return image?.name === product.name ? { ...image, reference: Boolean(image.sourceUrl) } : null;
}
