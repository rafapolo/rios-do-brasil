# Acesso ao HidroWebService (ANA)

> Aberta em 2026-11-03. **Ação do Rafael.** Destrava `qualidade-agua.md`: a rota `HidroSerieQA` da API nova da
> ANA (`www.ana.gov.br/hidrowebservice/...`) responde **401** sem credencial, e é a pista mais promissora de
> valores medidos de qualidade da água em escala nacional depois que o serviço de indicadores do SNIRH saiu do ar.

## Como pedir (manual oficial, versão de 14/03/2025)

- **Para:** hidro@ana.gov.br
- **Assunto:** solicitação de acesso ao HidroWebService para consumo de dados
- **Corpo:** motivo, nome completo e instituição (se houver).
- **Usuário** = CPF (ou CNPJ); a **senha** chega pelo e-mail usado no pedido.
- Não confundir com o SRDH (é para *enviar* dados, outro assunto e outro tipo de conta).

### Rascunho

> **Assunto:** Solicitação de acesso ao HidroWebService para consumo de dados
>
> Prezados,
>
> Solicito acesso ao HidroWebService para consumo de dados de qualidade da água (séries de monitoramento:
> OD, DBO, fósforo, turbidez, E. coli, IQA). O uso é o projeto aberto Rios do Brasil, um mapa interativo da
> rede hidrográfica que confronta a carga poluidora estimada a partir das outorgas com as medições das estações.
>
> Nome: Rafael Polo
> CPF: [CPF]
>
> Obrigado.

## Quando a senha chegar

- [ ] Guardar no `.env` do repo (`HIDROWEB_USER`, `HIDROWEB_PASSWORD`; nunca no git).
- [ ] Autenticar na rota OAuth (Swagger da hidrowebservice, `/EstacoesTelemetricas/OAUth/v1`) e testar `HidroSerieQA`
      numa estação conhecida.
- [ ] Medir cobertura: quantas estações têm série com valor (OD, DBO, P, turbidez, E. coli), de que anos, e
      limite de requisições. Registrar em `qualidade-agua.md` e seguir o plano de lá.

## Referências

- [Manual HidroWebService (ANA)](https://www.gov.br/ana/pt-br/assuntos/monitoramento-e-eventos-criticos/monitoramento-hidrologico/orientacoes-manuais/manuais/manual-hidrowebservice_publica.pdf)
- Clientes não oficiais com o mesmo par CPF + senha: [`hidroweb`](https://pypi.org/project/hidroweb/),
  [`hidrowebsdk`](https://pypi.org/project/hidrowebsdk/0.1.0/) (lê `HIDROWEB_USER`/`HIDROWEB_PASSWORD`).
