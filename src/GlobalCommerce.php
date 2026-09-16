<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/** 국가, 배송지와 통화별 상품 소계를 검증한다. 배송 가능 여부는 별도 검토한다. */
final class GlobalCommerce
{
    public const ADDRESS_REQUIREMENTS = [
        'postal_code' => ['KR', 'JP', 'US', 'CA', 'AU', 'GB', 'DE', 'FR'],
        'city' => ['KR', 'JP', 'US', 'CA', 'AU', 'GB', 'DE', 'FR'],
        'region' => ['JP', 'US', 'CA', 'AU'],
    ];
    public const COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';
    public const CURRENCIES = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG';

    /** 자유 입력 대신 국가 코드 목록에 포함된 값만 허용한다. */
    public static function country(mixed $value, bool $optional = false): ?string
    {
        $code = is_string($value) ? strtoupper(trim($value)) : '';
        if ($optional && $code === '') return null;
        if (!in_array($code, explode(' ', self::COUNTRIES), true)) {
            throw new RuntimeException('올바른 국가를 선택해 주세요.');
        }
        return $code;
    }

    /** 확실한 국가별 필수 항목만 적용하고 상세 주소 적합성은 운영 검토에 남긴다. */
    public static function address(mixed $input): array
    {
        if (!is_array($input)) throw new RuntimeException('배송지를 확인해 주세요.');
        $address = ['country_code' => self::country($input['country_code'] ?? null)];
        foreach (['recipient', 'postal_code', 'region', 'city', 'address1', 'address2', 'phone'] as $field) {
            if (isset($input[$field]) && !is_string($input[$field])) {
                throw new RuntimeException('배송지 입력 형식이 올바르지 않습니다.');
            }
            $address[$field] = trim($input[$field] ?? '');
            if (strlen($address[$field]) > 500) throw new RuntimeException('배송지 입력이 너무 깁니다.');
        }
        $required = ['recipient', 'address1', 'phone'];
        foreach (self::ADDRESS_REQUIREMENTS as $field => $countries) {
            if (in_array($address['country_code'], $countries, true)) $required[] = $field;
        }
        foreach ($required as $field) {
            if ($address[$field] === '') throw new RuntimeException('배송지 필수 정보를 모두 입력해 주세요.');
        }
        return $address;
    }

    /** 설정된 환율만 사용한다. 미확인 상품과 환율은 금액을 null로 보존한다. */
    public static function quote(?float $price, string $sourceCurrency, string $quoteCurrency, int $quantity, bool $complete): array
    {
        $sourceCurrency = strtoupper($sourceCurrency);
        $quoteCurrency = strtoupper(trim($quoteCurrency));
        if (!in_array($quoteCurrency, explode(' ', self::CURRENCIES), true)) {
            throw new RuntimeException('올바른 견적 통화를 선택해 주세요.');
        }
        if ($quantity < 1 || $quantity > 20) throw new RuntimeException('수량은 1~20개로 입력해 주세요.');
        $rate = null;
        $knownSource = in_array($sourceCurrency, explode(' ', self::CURRENCIES), true);
        if ($knownSource && $complete && $price !== null && is_finite($price) && $price > 0) {
            $krw = (float) \env_value('KRW_PER_JPY', '0');
            $usd = (float) \env_value('USD_JPY_RATE', '0');
            $rates = ['JPY' => 1.0];
            if (is_finite($krw) && $krw > 0) $rates['KRW'] = 1 / $krw;
            if (is_finite($usd) && $usd > 0) $rates['USD'] = $usd;
            $rate = $sourceCurrency === $quoteCurrency ? 1.0
                : (isset($rates[$sourceCurrency], $rates[$quoteCurrency]) ? $rates[$sourceCurrency] / $rates[$quoteCurrency] : null);
        }
        $digits = self::fractionDigits($quoteCurrency);
        $subtotal = $rate === null ? null : round($price * $quantity * $rate, $digits);
        if ($subtotal !== null && (!is_finite($subtotal) || $subtotal > 999999999999)) {
            throw new RuntimeException('상품 금액을 확인해 주세요.');
        }
        return [
            'source_currency' => $sourceCurrency,
            'source_unit_price' => $price,
            'quote_currency' => $quoteCurrency,
            'exchange_rate' => $rate,
            'rate_source' => $rate === null ? null : ($sourceCurrency === $quoteCurrency ? 'same_currency' : 'configured'),
            'quoted_at' => gmdate(DATE_ATOM),
            'quantity' => $quantity,
            'product_subtotal' => $subtotal,
            'service_fee' => null,
            'shipping_fee' => null,
            'tax' => null,
            'total' => null,
            'status' => 'manual_quote',
        ];
    }

    /** 상품 표시와 견적 계산에 동일한 통화 소수 자릿수를 적용한다. */
    public static function fractionDigits(string $currency): int
    {
        if (in_array($currency, ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'], true)) return 0;
        return in_array($currency, ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'], true) ? 3 : 2;
    }
}
