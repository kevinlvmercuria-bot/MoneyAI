// 附件自带参考图仅用于对应产品；数据库中的门店上传图优先。
const references = {
    P001: {
        name: '奶油裸色微法式',
        url: '/assets/product-references/P001.webp',
        sourceUrl:
            'https://www.pinterest.com/pin/micro-french-nails-are-so-classy-and-elegant--654359020879496339/',
        sourceTitle:
            'Micro French nails are so classy and elegant | Manicura de uñas, Uñas de manicura francesa, Manicura',
    },
    P002: {
        name: '黑曜极细法式',
        url: '/assets/product-references/P002.webp',
        sourceUrl: 'https://www.pinterest.com/pin/slim-french-tips-nails--899664463057814161/',
        sourceTitle: 'Slim French Tips Nails | Black and nude nails, Ombre nails, Stylish nails',
    },
    P003: {
        name: '莓果双层法式',
        url: '/assets/product-references/P003.webp',
        sourceUrl:
            'https://www.instyle.es/belleza/10-unas-francesas-mujeres-60-elegantes-distintas-tendencia_66561',
        sourceTitle:
            '10 tipos de uñas francesas que llevarán las madres 60+ en marzo: elegantes, distintas y en tendencia',
    },
    P004: {
        name: '燕麦裸色纯色',
        url: '/assets/product-references/P004.webp',
        sourceUrl:
            'https://www.swanbeauty.ca/nail-supplies/gel-nail-system/cnd-plexigel/negel010140d5-cnd-plexigel-builder-gel-05-fl-oz--15ml-oat-milk-01014',
        sourceTitle: 'CND Plexigel Builder Gel 0.5 fl. oz / 15ml Oat Milk 01014',
    },
    P005: {
        name: '蜜桃裸色渐变',
        url: '/assets/product-references/P005.webp',
        sourceUrl: 'https://www.morovan.com/blog/beauty-nude-nail-designs',
        sourceTitle: 'Exploring the Beauty of Nude Nail Designs',
    },
    P006: {
        name: '水光豆沙裸色',
        url: '/assets/product-references/P006.webp',
        sourceUrl: 'https://www.glamour.de/artikel/jelly-nails-manikuere-anleitung',
        sourceTitle: 'Jelly Nails: So geht der glasige Nageltrend ganz einfach | GLAMOUR',
    },
    P007: {
        name: '红茶猫眼',
        url: '/assets/product-references/P007.webp',
        sourceUrl: 'https://nz.pinterest.com/pin/charme-gel-tagged-cat-eye--585679126585913784/',
        sourceTitle:
            'Charme Gel – tagged "Cat Eye" – Daily Charme | Winter nails acrylic, Fall nail designs, Cat eye nails',
    },
    P008: {
        name: '雾紫丝绒猫眼',
        url: '/assets/product-references/P008.webp',
        sourceUrl: 'https://www.pinterest.com/pin/purple-velvet-nails--703756187615364/',
        sourceTitle:
            'Purple Velvet Nails | Cat Eye Nails | Purple Nails | Halloween Nails | Cool Fall Nails | Gelx Nails [Video] | Purple nails, Gel nails, Halloween nails',
    },
    P009: {
        name: '香槟碎钻猫眼',
        url: '/assets/product-references/P009.webp',
        sourceUrl: 'https://ar.pinterest.com/pin/510877151489087328/',
        sourceTitle:
            'cite2025年-2026年冬トレンド マグネットのネイルデザイン集｜人気順｜2ページ目｜ホットペッパービューティー | ネイルデザイン, Nailed it, 最新のネイルデザイン',
    },
    P010: {
        name: '日落蜜桃渐变',
        url: '/assets/product-references/P010.webp',
        sourceUrl: 'https://glamnaildesigns.com/summer-sunset-nails/',
        sourceTitle: 'Summer Sunset Nails: Dreamy Designs You’ll Love',
    },
    P011: {
        name: '灰蓝云雾渐变',
        url: '/assets/product-references/P011.webp',
        sourceUrl: 'https://minimodel.jp/room/nail/watercolor-nail',
        sourceTitle: '水彩ネイルの人気おすすめデザイン13選！セルフで楽しむやり方もチェックしよう♡',
    },
    P012: {
        name: '焦糖拿铁渐变',
        url: '/assets/product-references/P012.webp',
        sourceUrl: 'https://hu.pinterest.com/pin/598275131776500915/',
        sourceTitle:
            '27 Fabulous Nude Ombre Nail Ideas To Glam Up Your Outfits - 206 | Ombre nails, Ombre nail designs, Brown nails',
    },
    P013: {
        name: '水光蜜桃粉',
        url: '/assets/product-references/P013.webp',
        sourceUrl:
            'https://www.pinterest.com/pin/diy-how-to-do-the-viral-jelly-nails-trend-at-home-on-a-budget--185210603419217201/',
        sourceTitle:
            'DIY: How To Do The Viral Jelly Nails Trend At Home On A Budget | Gel nails, Nails, Blush nails',
    },
    P014: {
        name: '豆沙云雾纯色',
        url: '/assets/product-references/P014.webp',
        sourceUrl: 'https://nailbook.jp/design/9440015/',
        sourceTitle:
            'ワンカラー/大人/ジェルネイル - nail salon MUNのネイルデザイン[No.9440015]｜ネイルブック',
    },
    P015: {
        name: '冷调车厘子红',
        url: '/assets/product-references/P015.webp',
        sourceUrl: 'https://www.marieclaire.com/beauty/dark-cherry-red-nails/',
        sourceTitle: 'Dark Cherry Red Nails Are The Most Expensive Looking Manicure | Marie Claire',
    },
    P016: {
        name: '新中式黛青描金',
        url: '/assets/product-references/P016.webp',
        sourceUrl: 'https://id.pinterest.com/yeppiswln/nail/',
        sourceTitle: '10 ide Nail | manikur, warna kuku, desain seni kuku',
    },
    P017: {
        name: '朱砂花影新中式',
        url: '/assets/product-references/P017.webp',
        sourceUrl:
            'https://www.herworld.com/style/beauty/cny-nail-art-designs-for-the-year-of-the-ox-according-to-your-zodiac',
        sourceTitle:
            'CNY nail art designs for the Year of the Ox, according to your zodiac sign - Her World Singapore | Her World Singapore',
    },
    P018: {
        name: '青瓷水墨新中式',
        url: '/assets/product-references/P018.webp',
        sourceUrl:
            'https://www.pinterest.com/pin/this-celebrityapproved-green-jade-nailart-trend-is-perfect-for-fall--13862711344492256/',
        sourceTitle:
            'This Celebrity-Approved Green Jade Nail-Art Trend Is Perfect For Fall | Jade nails, Green acrylic nails, Green nails',
    },
    P019: {
        name: '基础甲周护理',
        url: '/assets/product-references/P019.webp',
        sourceUrl: 'https://blueskycosmetics.co.uk/blogs/blog/the-perfect-prescriptive-manicure',
        sourceTitle: 'The Perfect Prescriptive Manicure – Bluesky Cosmetics',
    },
    P020: {
        name: '深层手部 SPA 护理',
        url: '/assets/product-references/P020.webp',
        sourceUrl: 'https://medazur.md/en/procedure/120/spa_manicure_with_a_hand-to-elbow_massage',
        sourceTitle: 'SPA manicure with hand and forearm massage in Moldova, prices in Chisinau',
    },
    P021: {
        name: '甲面修护加固',
        url: '/assets/product-references/P021.webp',
        sourceUrl:
            'https://nailsami.com/blogs/guides/builder-gel-nails-complete-guide-to-natural-nail-overlays',
        sourceTitle:
            'Builder Gel Nails Guide: How to Use, Best Sets & Hard Gel vs Soft Gel (2026)  – NAILSAMI',
    },
    P022: {
        name: '温和卸甲护理',
        url: '/assets/product-references/P022.webp',
        sourceUrl:
            'https://delanes-natural-nail-care.ueniweb.com/services/nail-add-ons/gel-polish-removal-150366245',
        sourceTitle:
            "Gel Polish Removal - Nail Add Ons - Delane's Natural Nail Care | Nail Salon & Shop in San Leandro",
    },
    P023: {
        name: '单指补甲修护',
        url: '/assets/product-references/P023.webp',
        sourceUrl: 'https://www.nailquick.co.jp/article/p-20151027-1/',
        sourceTitle:
            '割れたネイルのケアをサロンではどうするの？リペアの方法を大公開 | ネイルクイック',
    },
    P024: {
        name: '居家甲缘护理油',
        url: '/assets/product-references/P024.webp',
        sourceUrl: 'https://sienna.co/blogs/news/our-tips-for-strong-beautiful-nails',
        sourceTitle: 'Our tips for strong, beautiful nails – sienna.co',
    },
};

export function productImage(product) {
    if (product.imageUrl) return { url: product.imageUrl, reference: false };
    const reference = references[product.id];
    return reference?.name === product.name ? { ...reference, reference: true } : null;
}
