export interface TicketConfirmationItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineDiscountAmount?: number;
  lineTotal?: number;
}

export interface TicketConfirmationDraft<TPayload> {
  kind: 'import' | 'export' | 'sale';
  documentNo: string;
  date: string;
  partnerLabel: string;
  partnerName: string;
  items: TicketConfirmationItem[];
  totalQuantity: number;
  totalAmount: number;
  subtotal?: number;
  lineDiscountTotal?: number;
  invoiceDiscountAmount?: number;
  discountAmount?: number;
  payload: TPayload;
}

export class TicketConfirmationGate<TPayload> {
  private currentDraft: TicketConfirmationDraft<TPayload> | null = null;
  private inFlight: Promise<void> | null = null;

  get draft() {
    return this.currentDraft;
  }

  prepare(draft: TicketConfirmationDraft<TPayload>) {
    if (this.inFlight) return this.currentDraft;
    this.currentDraft = draft;
    return draft;
  }

  cancel() {
    if (!this.inFlight) this.currentDraft = null;
  }

  confirm(writer: (draft: TicketConfirmationDraft<TPayload>) => Promise<void>) {
    if (!this.currentDraft) {
      return Promise.reject(new Error('Không có phiếu đang chờ xác nhận.'));
    }
    if (this.inFlight) return this.inFlight;
    const draft = this.currentDraft;
    this.inFlight = writer(draft)
      .then(() => {
        this.currentDraft = null;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
