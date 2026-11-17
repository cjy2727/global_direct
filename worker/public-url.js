import dns from 'node:dns/promises';
import net from 'node:net';
export function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 10
      || p[0] === 127
      || p[0] === 0
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
      || p[0] >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.');
}

export async function assertPublicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('상품 URL이 올바르지 않습니다.');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP 또는 HTTPS 상품 URL만 사용할 수 있습니다.');
  const addresses = await resolvePublicHost(url.hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('내부 네트워크 주소는 사용할 수 없습니다.');
  return url;
}


export async function resolvePublicHost(host) {
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Public address required');
  return addresses;
}
