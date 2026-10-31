type Party = 'BUYER' | 'SELLER';
type Text = (to: Party, title: string, number: string) => [string, string];

/** Italian texts of the order notifications (templates named by the domain state machine). */
export const ORDER_TEMPLATES: Record<string, Text> = {
  'order.paid': (to, t, n) =>
    to === 'SELLER'
      ? [
          'Hai venduto!',
          `«${t}» è stato pagato (ordine ${n}). Spediscilo entro 5 giorni lavorativi: nella pagina dell'ordine trovi l'etichetta (o dove inserire il tracking) e la guida «Come imballare uno strumento».`,
        ]
      : [
          'Pagamento ricevuto',
          `Il pagamento per «${t}» (ordine ${n}) è andato a buon fine ed è protetto finché confermi la ricezione.`,
        ],
  'order.paid.handover': (to, t, n) =>
    to === 'SELLER'
      ? [
          'Hai venduto!',
          `«${t}» è stato pagato (ordine ${n}). Accordati per la consegna a mano entro 7 giorni: all'incontro l'acquirente ti darà il codice di consegna.`,
        ]
      : [
          'Pagamento ricevuto',
          `Il pagamento per «${t}» (ordine ${n}) è protetto. Comunica il codice di consegna al venditore solo dopo aver visto e provato lo strumento.`,
        ],
  'order.label_ready': (_to, t, n) => [
    'Etichetta pronta',
    `L'etichetta per «${t}» (ordine ${n}) è pronta: scaricala dalla pagina dell'ordine, imballa lo strumento seguendo la nostra guida e consegnalo al corriere o al punto di ritiro.`,
  ],
  'order.shipping_exception': (_to, t, n) => [
    'Problema con la spedizione',
    `Il corriere segnala un problema con la spedizione di «${t}» (ordine ${n}). Controlla il tracking nella pagina dell'ordine; se non si risolve in pochi giorni interverrà il supporto.`,
  ],
  'order.returned_to_sender': (_to, t, n) => [
    'Pacco tornato al mittente',
    `Il pacco di «${t}» (ordine ${n}) è tornato al mittente. Il supporto verificherà e ti contatterà.`,
  ],
  'order.ship_reminder': (_to, t, n) => [
    'Ricordati di spedire',
    `Mancano 24 ore al termine per spedire «${t}» (ordine ${n}).`,
  ],
  'order.shipped': (_to, t, n) => [
    'Il tuo ordine è in viaggio',
    `«${t}» (ordine ${n}) è stato spedito. Quando lo ricevi, controllalo e conferma la ricezione.`,
  ],
  'order.delivered': (_to, t, n) => [
    'Consegnato',
    `«${t}» (ordine ${n}) risulta consegnato. Hai 72 ore per verificarlo prima che il pagamento venga trasferito.`,
  ],
  'order.completed': (to, t, n) =>
    to === 'SELLER'
      ? [
          'Ordine completato',
          `L'acquirente ha confermato la ricezione di «${t}» (ordine ${n}): il pagamento è in trasferimento.`,
        ]
      : [
          'Ordine completato',
          `Hai confermato la ricezione di «${t}» (ordine ${n}). Grazie! Presto potrai lasciare un feedback.`,
        ],
  'order.completed.auto': (_to, t, n) => [
    'Ordine completato',
    `L'ordine ${n} per «${t}» si è chiuso automaticamente: il pagamento è stato trasferito al venditore.`,
  ],
  'order.completed.handover': (to, t, n) =>
    to === 'SELLER'
      ? [
          'Consegna verificata',
          `Codice corretto: l'ordine ${n} per «${t}» è completato e il pagamento è in trasferimento.`,
        ]
      : [
          'Consegna verificata',
          `Il venditore ha inserito il tuo codice: l'ordine ${n} per «${t}» è completato.`,
        ],
  'order.cancelled.seller': (_to, t, n) => [
    'Ordine annullato',
    `Il venditore ha annullato l'ordine ${n} per «${t}». L'acquirente riceve il rimborso totale.`,
  ],
  'order.cancelled.ship_deadline': (_to, t, n) => [
    'Ordine annullato',
    `L'ordine ${n} per «${t}» è stato annullato perché non è stato spedito in tempo. L'acquirente riceve il rimborso totale.`,
  ],
  'order.cancelled.mutual': (_to, t, n) => [
    'Ordine annullato',
    `L'ordine ${n} per «${t}» è stato annullato di comune accordo. L'acquirente riceve il rimborso totale.`,
  ],
  'order.cancelled.handover_expired': (_to, t, n) => [
    'Ordine annullato',
    `La consegna a mano per l'ordine ${n} («${t}») non è avvenuta entro 7 giorni: rimborso totale all'acquirente.`,
  ],
  'order.cancel_requested': (_to, t, n) => [
    'Richiesta di annullamento',
    `L'altra parte chiede di annullare l'ordine ${n} per «${t}». Puoi accettare dalla pagina dell'ordine.`,
  ],
  'dispute.opened': (_to, t, n) => [
    'Controversia aperta',
    `È stata aperta una controversia sull'ordine ${n} («${t}»).`,
  ],
  'dispute.seller_responded': (_to, t, n) => [
    'Il venditore ha risposto',
    `Il venditore ha risposto alla controversia sull'ordine ${n} («${t}»). Controlla la proposta nella pagina dell'ordine.`,
  ],
  'dispute.proposal_accepted': (_to, t, n) => [
    'Proposta accettata',
    `L'acquirente ha accettato il rimborso parziale proposto per l'ordine ${n} («${t}»). Il resto del pagamento ti viene trasferito.`,
  ],
  'dispute.escalated': (_to, t, n) => [
    'Controversia al supporto',
    `La controversia sull'ordine ${n} («${t}») passa al nostro supporto, che deciderà entro 5 giorni lavorativi. Potrebbe chiedervi altre prove.`,
  ],
  'dispute.withdrawn': (_to, t, n) => [
    'Controversia ritirata',
    `L'acquirente ha ritirato la controversia sull'ordine ${n} («${t}»): il pagamento ti viene trasferito.`,
  ],
  'dispute.resolved': (_to, t, n) => [
    'Controversia decisa',
    `Il supporto ha deciso la controversia sull'ordine ${n} («${t}»). Trovi la motivazione nella pagina dell'ordine; puoi presentare ricorso entro 7 giorni.`,
  ],
  'dispute.appealed': (_to, t, n) => [
    'Ricorso presentato',
    `È stato presentato un ricorso sulla decisione per l'ordine ${n} («${t}»). Lo esaminerà un altro membro dello staff.`,
  ],
  'dispute.appeal_decided': (_to, t, n) => [
    'Esito del ricorso',
    `Il ricorso sull'ordine ${n} («${t}») è stato esaminato. Trovi l'esito nella pagina dell'ordine.`,
  ],
  'dispute.return_required': (to, t, n) =>
    to === 'BUYER'
      ? [
          'Reso richiesto',
          `Per l'ordine ${n} («${t}») è previsto il reso: scarica l'etichetta dalla pagina dell'ordine e spedisci entro 5 giorni lavorativi. Il rimborso parte quando il venditore lo riceve.`,
        ]
      : [
          'Reso in arrivo',
          `L'acquirente ti rispedirà «${t}» (ordine ${n}). Alla consegna avrai 48 ore per segnalare problemi sullo stato dell'oggetto.`,
        ],
  'dispute.resolved.full_refund': (_to, t, n) => [
    'Rimborso totale',
    `La controversia sull'ordine ${n} («${t}») si è chiusa con il rimborso totale all'acquirente.`,
  ],
  'dispute.resolved.partial_refund': (_to, t, n) => [
    'Rimborso parziale',
    `La controversia sull'ordine ${n} («${t}») si è chiusa con un rimborso parziale; il resto è trasferito al venditore.`,
  ],
  'dispute.resolved.release': (_to, t, n) => [
    'Controversia chiusa',
    `La controversia sull'ordine ${n} («${t}») si è chiusa: il pagamento è trasferito al venditore.`,
  ],
  'dispute.return_accepted': (_to, t, n) => [
    'Reso accettato',
    `Il reso dell'ordine ${n} («${t}») è stato accettato: rimborso totale all'acquirente.`,
  ],
  'dispute.return_not_shipped': (_to, t, n) => [
    'Reso non spedito',
    `Il reso dell'ordine ${n} («${t}») non è stato spedito in tempo: il pagamento è trasferito al venditore.`,
  ],
  'chargeback.opened': (_to, t, n) => [
    'Contestazione bancaria',
    `L'acquirente ha contestato con la banca il pagamento dell'ordine ${n} («${t}»). Abbiamo inviato le prove a Stripe; il trasferimento è sospeso fino all'esito.`,
  ],
  'chargeback.won': (_to, t, n) => [
    'Contestazione respinta',
    `La banca ha respinto la contestazione sull'ordine ${n} («${t}»).`,
  ],
  'chargeback.lost_protected': (_to, t, n) => [
    'Sei protetto',
    `La contestazione sull'ordine ${n} («${t}») è stata accolta dalla banca, ma hai rispettato le regole: la perdita è a carico nostro.`,
  ],
  'chargeback.lost_seller': (_to, t, n) => [
    'Contestazione accolta',
    `La contestazione sull'ordine ${n} («${t}») è stata accolta dalla banca e l'importo viene recuperato dai tuoi incassi.`,
  ],
};
