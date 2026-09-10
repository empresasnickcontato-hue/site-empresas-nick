# Teste WhatsApp — Empresas Nick

## 1. Configure `.env` (front na raiz)

```env
VITE_MY_WHATSAPP_API_URL=https://sua-api.com/send
VITE_MY_WHATSAPP_API_KEY=sua_api_key_aqui
VITE_OWNER_PHONE=5511999999999
```

## 2. Curl direto na SUA API (formato atual)

```bash
curl -X POST "$VITE_MY_WHATSAPP_API_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $VITE_MY_WHATSAPP_API_KEY" \
  -d '{
    "to": "'$VITE_OWNER_PHONE'",
    "message": "*Novo atendimento escalado — Empresas Nick*\n*Nome:* João Silva\n*WhatsApp:* (11) 99999-9999\n*Histórico:*\n*Cliente* (14:02): Preço?\n*Bot* (14:02): Planos...",
    "type": "text"
  }'
```

> Se sua API usa formato diferente, ajuste em `src/services/myWhatsAppApi.ts`:
> ```ts
> // body: JSON.stringify({ phone: ownerPhone, text: message })
> // headers: { Authorization: `Bearer ${apiKey}` }
> ```

## 3. Fluxo no front

1. Clique **Falar com Suporte** (home ou dashboard)
2. Informe **nome + WhatsApp** com máscara `(99) 99999-9999`
3. Use **sugestões rápidas** ou digite
4. Bot responde sobre *preços, fatura dia 10, pagamento, prazo, reembolso* com `*negrito*`
5. Após **3 tentativas** sem entender ou digitar `humano`, escala → salva em `support_conversations` (Supabase) + envia WhatsApp formatado

## 4. Supabase

```sql
create table support_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  messages jsonb not null,
  status text not null check (status in ('open','escalated','closed')),
  created_at timestamptz default now()
);
```
