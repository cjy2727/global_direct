import { ServiceError } from './jobs.js';

/** Inspect product-specific areas, never the store header or recommendation lists. */
export function collectProductEvidence({ structuredProduct = {}, collectedProduct = {}, sourceUrl = '' } = {}) {
  const excluded = 'nav,header,footer,[class*="recommend" i],[id*="recommend" i],[class*="related" i],[id*="related" i]';
  const roots = [...document.querySelectorAll('[itemtype*="schema.org/Product"],.product-detail,.product-info,.product_detail,.product_info,#productDetail,#goods_view,[data-product-detail]')]
    .filter(node => !node.closest(excluded));
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const hasDetails = roots.some(root => [...root.querySelectorAll('[itemprop="name"],[itemprop="price"],.product-name,.product-title,.product-price,[data-product-name],img,select,input[optiontype]')]
    .some(node => !node.closest(excluded) && (text(node) || node.getAttribute('content') || node.getAttribute('src') || node.tagName === 'SELECT')));
  const heading = [...document.querySelectorAll('h1')].find(node => !node.closest(excluded));
  const gallery = document.querySelector('[data-main-image],.product-gallery img,.product-main-image img,[itemprop="image"]');
  const productMeta = document.querySelector('meta[property="product:price:amount"],meta[property="og:type"][content="product"],meta[property="og:type"][content="og:product"]');
  // Generic layouts may expose real product data without any of the roots above.
  // Require the requested page identity and corroborated collected fields, so store
  // titles, logos and prices from a redirected home page cannot qualify together.
  const normalize = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const samePage = (left, right) => {
    try {
      const a = new URL(left, location.href), b = new URL(right, location.href);
      return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')
        && [...a.searchParams].filter(([key]) => !/^(?:utm_|gclid$|fbclid$)/i.test(key))
          .every(([key, value]) => b.searchParams.get(key) === value);
    } catch { return false; }
  };
  const ogTitle = normalize(document.querySelector('meta[property="og:title"]')?.content);
  const ogImage = document.querySelector('meta[property="og:image"]')?.content;
  const ogUrl = document.querySelector('meta[property="og:url"]')?.content;
  const title = normalize(collectedProduct.title);
  const images = Array.isArray(collectedProduct.images) ? collectedProduct.images : [];
  const imageMatched = ogImage && images.some(image => {
    try { return new URL(image, location.href).href === new URL(ogImage, location.href).href; } catch { return false; }
  });
  const titleMatched = title && title === text(heading) && title === ogTitle;
  const dataMatched = samePage(sourceUrl, location.href) && ogUrl && samePage(sourceUrl, ogUrl)
    && titleMatched && imageMatched && (Number.isFinite(collectedProduct.price)
      || collectedProduct.optionGroups?.length > 0);
  return { identified: Boolean(structuredProduct.name || hasDetails || productMeta || text(heading) && gallery || dataMatched) };
}

/** A partial real product remains reviewable; generic page metadata is not a product. */
export function validateProductData(product, evidence = {}) {
  const title = typeof product.title === 'string' && product.title.trim();
  const price = typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0;
  const images = Array.isArray(product.images) && product.images.length > 0;
  const options = Array.isArray(product.optionGroups) && product.optionGroups.length > 0;
  const description = typeof product.description === 'string' && product.description.trim();
  if (!evidence.identified || !(title || price || images || options || description)) {
    throw new ServiceError('product_data_missing', '요청한 상품의 정보를 수집하지 못했습니다.', 422);
  }
  return { ...product, status: title && price && images && ['complete', 'none'].includes(product.optionAnalysis?.status)
    ? product.status : 'needs_review' };
}
