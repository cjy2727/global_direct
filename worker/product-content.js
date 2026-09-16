/** 브라우저 DOM에서 상품 갤러리와 설명 블록만 추출한다. 외부 HTML은 반환하지 않는다. */
export function extractProductContent({ product = {} } = {}) {
  const cleanText = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const safeUrl = (value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
    try {
      const url = new URL(value.trim(), document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const excluded = 'script, style, noscript, template, iframe, form, nav, footer, [hidden], [aria-hidden="true"], .reviews, #reviews, [class*="recommend" i], [id*="recommend" i], [class*="related" i], [id*="related" i], [class*="banner" i], [class*="advert" i], [class*="review" i], [id*="review" i]';
  const isExcluded = (node) => Boolean(node.closest(excluded));
  const descriptionSelectors = [
    '#productDescription', '#product-description', '#product_description', '#prodDetailView', '#description',
    // Makeshop의 #productDetail은 페이지 전체이므로 실제 설명 컨테이너만 선택한다.
    '#product-detail-content', '#productDetail .prd-detail', '.prd-detail', '#detail .cont', '#prdDetail .cont',
    '.product-description', '.product__description', '.product-detail-description',
    '[data-product-description]', '[itemprop="description"]', '#aplus', '#feature-bullets',
    '#productDetails_techSpec_section_1', '#productDetails_detailBullets_sections1',
    '.product-specifications', '#product-specifications', '[data-product-specifications]',
  ];
  const descriptionRoots = [...new Set(descriptionSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
    .filter((node, index, nodes) => !isExcluded(node) && !nodes.some((other) => other !== node && other.contains(node)));

  /** 지연 로딩 원본과 확대 이미지를 우선하고 작은 아이콘·로딩용 이미지는 버린다. */
  const imageUrl = (image) => {
    if (isExcluded(image)) return null;
    const width = Number(image.getAttribute('width'));
    const height = Number(image.getAttribute('height'));
    if ((width > 0 && width <= 32) && (height > 0 && height <= 32)) return null;
    const srcset = image.getAttribute('data-srcset') || image.getAttribute('srcset')
      || image.closest('picture')?.querySelector('source')?.getAttribute('srcset') || '';
    const largest = srcset.split(',').map((entry) => {
      const [url, size = '1'] = entry.trim().split(/\s+/);
      return { url, size: parseFloat(size) || 1 };
    }).sort((a, b) => b.size - a.size)[0]?.url;
    const candidates = [image.getAttribute('data-zoom-image'), image.getAttribute('data-old-hires'),
      image.getAttribute('data-large-image'), image.getAttribute('data-original'), image.getAttribute('data-src'),
      largest, image.currentSrc, image.getAttribute('src')];
    return candidates.map(safeUrl).find((url) => url && !/(?:placeholder|spacer|loading|transparent|logo|sprite)(?:[._/-]|$)/i.test(new URL(url).pathname)) || null;
  };
  const gallerySelectors = [
    '#landingImage', '#imgBlkFront', '[data-main-image]', '.product-main-image img',
    '.product-image-main img', '[itemprop="image"]', '#imageBlock img',
    '.product-gallery img', '.product__media img', '.product-media img',
    '.product-images img', '.product-image img', '.product_image img',
    '[data-product-gallery] img', '[data-product-media] img',
  ];
  const gallery = [];
  for (const selector of gallerySelectors) {
    for (const image of document.querySelectorAll(selector)) {
      if (image.tagName !== 'IMG' || descriptionRoots.some((root) => root.contains(image))) continue;
      const url = imageUrl(image);
      if (url && !gallery.includes(url)) gallery.push(url);
    }
  }
  const structuredImages = [];
  const addStructuredImage = (value) => {
    if (Array.isArray(value)) return value.forEach(addStructuredImage);
    if (value && typeof value === 'object') return addStructuredImage(value.url || value.contentUrl);
    const url = safeUrl(value);
    if (url && !structuredImages.includes(url)) structuredImages.push(url);
  };
  addStructuredImage(product.image);
  const socialImage = safeUrl(document.querySelector('meta[property="og:image"]')?.content);
  const images = (gallery.length ? gallery : structuredImages.length ? structuredImages : socialImage ? [socialImage] : []).slice(0, 12);
  const imageSource = gallery.length ? 'gallery' : structuredImages.length ? 'structured_data' : socialImage ? 'open_graph' : 'unavailable';

  const blocks = [];
  const seenImages = new Set(images);
  let textLength = 0;
  let imageCount = 0;
  const addText = (type, text, name = '') => {
    text = cleanText(text);
    if (!text || blocks.length >= 120 || textLength >= 20000) return;
    text = text.slice(0, Math.min(4000, 20000 - textLength));
    if (blocks.some((block) => block.type === type && block.text === text && (block.name || '') === name)) return;
    blocks.push({ type, text, ...(name ? { name: name.slice(0, 200) } : {}) });
    textLength += text.length;
  };
  const addDetailImage = (node) => {
    const url = imageUrl(node);
    if (!url || seenImages.has(url) || imageCount >= 24 || blocks.length >= 120) return;
    blocks.push({ type: 'image', url, alt: cleanText(node.alt).slice(0, 200) });
    seenImages.add(url);
    imageCount++;
  };
  /** 텍스트/이미지 순서를 유지하면서 실행 가능한 노드와 불필요한 영역은 건너뛴다. */
  const visit = (node, depth = 0) => {
    if (depth > 30 || blocks.length >= 120) return;
    if (node.nodeType === Node.TEXT_NODE) { addText('text', node.textContent); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || isExcluded(node)) return;
    if (node.tagName === 'IMG') { addDetailImage(node); return; }
    if (node.tagName === 'TR') {
      const cells = [...node.children].filter((child) => ['TD', 'TH'].includes(child.tagName));
      if (cells.length === 2 && !node.querySelector('img, script, style, iframe')) {
        addText('specification', cells[1].textContent, cleanText(cells[0].textContent));
        return;
      }
    }
    if (node.tagName === 'DT' && node.nextElementSibling?.tagName === 'DD') {
      addText('specification', node.nextElementSibling.textContent, cleanText(node.textContent));
      return;
    }
    if (node.tagName === 'DD' && node.previousElementSibling?.tagName === 'DT') return;
    if (/^H[2-6]$/.test(node.tagName) && !node.querySelector(excluded)) { addText('heading', node.textContent); return; }
    if (['P', 'LI'].includes(node.tagName) && !node.querySelector(`img, ${excluded}`)) { addText('text', node.textContent); return; }
    for (const child of node.childNodes) visit(child, depth + 1);
  };
  descriptionRoots.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).forEach((root) => visit(root));
  // 구조화 설명의 HTML도 실행하지 않고 텍스트로만 읽는다.
  const plainDescription = (value) => {
    const template = document.createElement('template');
    template.innerHTML = typeof value === 'string' ? value.slice(0, 60000) : '';
    template.content.querySelectorAll('script, style, iframe, object, embed').forEach((node) => node.remove());
    return cleanText(template.content.textContent);
  };
  const summary = plainDescription(product.description)
    || cleanText(document.querySelector('meta[property="og:description"]')?.content);
  if (!blocks.length) addText('text', summary);
  for (const property of (Array.isArray(product.additionalProperty) ? product.additionalProperty : [])) {
    if (typeof property?.name === 'string' && ['string', 'number'].includes(typeof property.value)) {
      addText('specification', String(property.value), cleanText(property.name));
    }
  }
  return { images, mainImage: images[0] || null, description: summary.slice(0, 1000),
    content: { version: 1, imageSource, blocks, status: blocks.length ? 'extracted' : 'unavailable' } };
}
