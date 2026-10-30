import type { ItemCondition, ListingDetail, ListingUpdate, ParcelSize } from '@accordo/shared';
import type { ComuneValue } from '@/components/comune-combobox';
import { centsToInput, parseEuroToCents } from '@/lib/price';

export interface WizardForm {
  title: string;
  categoryId: string | null;
  brand: { id: string; name: string } | null;
  modelName: string;
  year: string;
  condition: ItemCondition | null;
  attributes: Record<string, unknown>;
  description: string;
  price: string;
  isNegotiable: boolean;
  acceptsTrades: boolean;
  shippingIntegrated: boolean;
  parcelSize: ParcelSize | null;
  shippingSelf: boolean;
  selfShippingPrice: string;
  handDeliveryEnabled: boolean;
  comune: ComuneValue | null;
}

export const EMPTY_FORM: WizardForm = {
  title: '',
  categoryId: null,
  brand: null,
  modelName: '',
  year: '',
  condition: null,
  attributes: {},
  description: '',
  price: '',
  isNegotiable: false,
  acceptsTrades: false,
  shippingIntegrated: true,
  parcelSize: null,
  shippingSelf: false,
  selfShippingPrice: '',
  handDeliveryEnabled: true,
  comune: null,
};

export function formFromListing(l: ListingDetail): WizardForm {
  return {
    title: l.title,
    categoryId: l.category.id,
    brand: l.brand ? { id: l.brand.id, name: l.brand.name } : null,
    modelName: l.modelName ?? '',
    year: l.year ? String(l.year) : '',
    condition: l.condition,
    attributes: l.rawAttributes,
    description: l.description,
    price: centsToInput(l.priceCents),
    isNegotiable: l.isNegotiable,
    acceptsTrades: l.acceptsTrades,
    shippingIntegrated: l.shippingIntegrated,
    parcelSize: l.parcelSize,
    shippingSelf: l.shippingSelf,
    selfShippingPrice: centsToInput(l.selfShippingPriceCents),
    handDeliveryEnabled: l.handDeliveryEnabled,
    comune: {
      id: l.location.comuneId,
      name: l.location.comune,
      provinciaSigla: l.location.provinciaSigla,
    },
  };
}

/** Fields of the form as an API payload; invalid partial values are simply left out (drafts). */
export function toPayload(f: WizardForm): ListingUpdate {
  const year = Number.parseInt(f.year, 10);
  const price = parseEuroToCents(f.price);
  const selfPrice = parseEuroToCents(f.selfShippingPrice);
  return {
    ...(f.title.trim().length >= 3 ? { title: f.title.trim() } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.condition ? { condition: f.condition } : {}),
    brandId: f.brand?.id ?? null,
    modelName: f.modelName.trim() || null,
    year: Number.isInteger(year) && year >= 1900 ? year : null,
    attributes: f.attributes,
    description: f.description,
    priceCents: price ?? 0,
    isNegotiable: f.isNegotiable,
    acceptsTrades: f.acceptsTrades,
    shippingIntegrated: f.shippingIntegrated,
    parcelSize: f.shippingIntegrated ? f.parcelSize : null,
    shippingSelf: f.shippingSelf,
    selfShippingPriceCents: f.shippingSelf ? selfPrice : null,
    handDeliveryEnabled: f.handDeliveryEnabled,
    ...(f.comune ? { comuneId: f.comune.id } : {}),
  };
}

export const LOCAL_DRAFT_KEY = 'accordo:sell-draft';
