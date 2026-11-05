# Tour de 2 minutos: fatos e conferência

Roteiro em `tour.json` (12 cenas, 120 s). Esta nota guarda, para cada número, de onde saiu, qual era a ordem de grandeza esperada e a segunda via que o confirmou. Consultas pelo espelho (DuckDB no beelink, somente leitura); derivados do próprio projeto lidos de `pipeline/` sem escrita (`rede_vazao.json` decodificado, `tendencia.json`, `paineis.json`, `barragens.parquet`, `captacoes.parquet`).

Convenções: m³/s = vazão média; "trecho" = trecho da BHO; vazão do mapa = estimada/medida do `rede_vazao.json`. Foz = trecho cujo `NUTRJUS` não existe na tabela (1.505, igual ao número documentado na BHO); fora do Brasil = lista `fora` do `rede_vazao.json`.

## 1. Brasil / Amazonas: 198 mil m³/s, 85% da água que chega ao litoral brasileiro
- Cálculo: soma da vazão dos trechos de foz que não estão fora do Brasil = 232.142 m³/s em 1.339 fozes; Amazonas (trecho 8423, 0,18°N, 50,70°O) = 198.403. 198.403 / 232.142 = 85,5%. Em seguida vêm a baía de Marajó/Tocantins (15.799; 6,8%), Guaíba (2.131) e o São Francisco (1.607).
- Esperado: Amazonas ~200 mil m³/s (publicado ~209 mil na foz); nenhum outro rio brasileiro passa de 16 mil.
- Conferência independente: estação Óbidos (ANA 17050001), série consistida 1995–2023: média mensal 170.499 m³/s; Tapajós em Buburé 12.635 m³/s (o Madeira já está a montante de Óbidos). 170,5 + 12,6 + Xingu e afluentes menores abaixo de Óbidos ≈ 190 mil, dentro de 5% dos 198 mil. BHO: área a montante máxima 5,92 milhões de km² (documentado, Amazonas na foz).
- Cuidado: a vazão inclui a água que o Amazonas traz do Peru/Colômbia e exclui Paraná, Paraguai e Uruguai, que saem do Brasil rumo ao Prata. O texto diz "desemboca no litoral brasileiro" por isso.

## 2. São Francisco: 1,6 mil m³/s na foz, cem vezes menos que o Amazonas
- Foz estimada no mapa (trecho 121957, 10,5°S 36,4°O): 1.607 m³/s; 198.403 / 1.607 = 123 vezes.
- Conferência: estação Propriá (ANA 49705000), média 1995–2023: 1.634 m³/s; Óbidos / Propriá = 170.499 / 1.634 = 104 vezes. O texto fala "cem vezes", que cobre as duas razões. Publicado (pós-Sobradinho): 1,8–2 mil m³/s.
- Cuidado: a série só cobre a era regulada (1995+), de propósito; a vazão natural pré-barragens era maior.

## 3. Sobradinho: 364 dias abaixo de 10% do volume útil
- SQL: `br_ana_reservatorios.sin`, id 19121, `proporcao_volume_util BETWEEN -50 AND 105` (filtro do gotcha), dias com valor < 10 entre 2014 e 2019: 364, de 2015-09-19 a 2018-01-01; 172 dias < 5%; mínimo 1,0% em 2015-12-02. Defluência média anual: 1.979 m³/s (2011), 677 (2017); mínimo diário 551 em 2017-10-24.
- Esperado: dezenas a poucas centenas de dias; nunca mais que a seca de 2015–17.
- Conferência independente (cota em vez de volume): cota mínima 380,76 m contra o nível mínimo operativo de 380,5 m; 152 dias com cota < 381,5 m, em 2015–2017. Anos fora dessa janela: 0 dias < 10%, exceto 2001 (85 dias, crise do apagão), que o texto não afirma ser a única.
- Cuidado: a série do SAR termina em janeiro de 2022. O mosaico de satélite (2016) pega o lago perto do pior momento; é intencional na cena.

## 4. Amazonas: 773 mil km de rio contínuo
- Cálculo: pedaço 0 da tabela `livreKm` (barragens.py, soma `comp` dos trechos conectados sem barragem): 773.397 km, 26% dos 2.953.199 km da rede (21,6% da rede brasileira); 531.708 km dentro do Brasil. Segundo: Madeira a montante de Jirau, 168.336 km, coincide com a coordenada de Jirau (64,64°O 9,24°S); São Francisco a montante de Sobradinho, 82.644 km; Xingu a montante de Belo Monte, 78.542 km.
- Conferência: recontagem direta somando `comp` por pedaço bate com a tabela (773.397); bacia "Rio Amazonas" soma 1.104.374 km, logo 773 mil < 1,10 milhão, como esperado. Mesma conta reproduz o número do README: 38,8% da rede brasileira corre até o mar sem barragem.
- Cuidado: 38% dos trechos do pedaço ficam fora do Brasil. O cadastro tem barragens que não cortam a rede desenhada (10.965 órfãs), então "sem barragem" é "sem barragem cadastrada".

## 5. Paranapanema: 11 usinas em ~900 km
- SQL: `br_aneel_dadosabertos.siga_empreendimentos_geracao`, `SigTipoGeracao='UHE'`, `DscFaseUsina='Operação'`; as 11 do eixo principal (Jurumirim, Piraju, Paranapanema, Chavantes, Ourinhos, Salto Grande, Canoas II, Canoas I, Capivara, Taquaruçu, Rosana) estão todas na lista. Mauá e Tibagi Montante são do Tibagi e Mourão I é de afluente: ficaram fora.
- Conferência: `barragens.parquet` (camada do mapa) lista as mesmas 11 com `rio = Rio Paranapanema`; o comprimento do nome "Rio Paranapanema" na rede soma 904 km (publicado: 929 km). 904 / 11 = 82 km por usina.
- Cuidado: "uma a cada 80 km" é média; as usinas se concentram entre 49,2°O e 50,5°O.

## 6. Piranhas-Açu: licença de 38 m³/s sobre 17 m³/s
- Cálculo: trecho 7925 (5,11°S 36,65°O), vazão 17,39 m³/s, `out` = 217%, ou seja 37,8 m³/s de licença acumulada a montante (outorgas de captação vigentes, sem poço).
- Ordem de grandeza: a camada tem teto de 300% e 2.558 trechos em ≥100%; nos grandes rios medidos o normal é < 10%.
- Conferência: (a) estação Alto Rodrigues (ANA 37750000, no Piranhas-Açu), 16,5 m³/s medidos 2007–2023, contra 17,4 do mapa; (b) soma por retângulo da bacia no `captacoes.parquet` = 47,8 m³/s (limite superior, pega vizinhos); (c) `br_ana_outorgas.captacoes` do banco, soma dos 16 municípios do vale no RN = 29,7 m³/s (inclui poço). 29,7 < 37,8 < 47,8, e todos acima de 17.
- Cuidado: licença não é uso, nem consumo; metade é irrigação e parte é carcinicultura. O rio é regulado pelo açude Armando Ribeiro Gonçalves, cuja vazão regularizada ultrapassa a média natural: a razão pega "licença sobre vazão média", não sobre vazão garantida. Texto diz "licenças de captação", não "retirada".

## 7. Taperoá: seco em 7 de cada 10 dias
- SQL: `series_vazao_diaria`, bacia 38, estação 38850000 (Poço de Pedras, PB). Nível 2: 15.054 dias (1970–2014), 10.516 com status 4/5/6 (régua seca, cortado, seco); nível 1: 2.987 dias (2015–2023), 2.508. Total 13.024 de 18.041 = 72,2%.
- Conferência independente: vazão igual a zero em 13.688 dias = 75,9%. O painel `paineis.json` conta 11.934 dias secos em 43 anos com ≥300 dias = 76%. Todas as vias ficam entre 70% e 76%; o texto usa o piso.
- Cuidado: rio intermitente no semiárido é o normal, não é sinal de seca recente. É um contexto de escala, por isso a cena não afirma tendência.

## 8. Oeste da Bahia: 26 de 26 em queda, Formoso 94 para 47 m³/s
- Cálculo: caixa de `series.html` (lat -16,2 a -10; lon -46,8 a -44; sem o tronco do São Francisco) com ranking: 26 estações, todas significativas, todas em queda, nenhuma em alta (`tendencia.json`: Mann-Kendall + Theil-Sen).
- Conferência independente (outro método, sem teste estatístico): média das 10 primeiras contra as 10 últimas séries anuais completas (12 meses, nível 2) de cada uma das 26. Resultado: 26 de 26 menores. Piores: São Desidério (Fazenda Coqueiro) -63%, Coxá -56%, Rio Grande em Barreiras -54% (123 para 56 m³/s desde 1935). Formoso em Colônia do Formoso: 93,9 para 47,1 m³/s (-49,9%); em Gatos 91,7 para 46,7. Menor queda: Sapão -7,6%.
- Cuidado: a primeira década varia por estação (1935 a 1977); o texto diz "da primeira à última década". Fonte da causa não é afirmada: bombeamento de poço do Urucuia não entra na camada de outorga (poço excluído).

## 9. Pantanal: Corumbá perdeu 61% da superfície de água
- SQL: `cobertura_municipio_classe`, `id_classe=33`, município 5003207, média 1985–89 contra 2017–21: 17.021 para 6.570 km² (-61,4%; hectares/100).
- Conferência: estado de MS (mesma tabela municipal, soma dos municípios) -48,5%; tabela por UF (`cobertura_uf_classe`) -57,7% (README); MT -34,7% e -46,0%. As coleções diferem, mas toda via dá queda de 35 a 61%. Brasil inteiro: -12,4% (192.597 para 168.658 km²).
- Cuidado (ponto frágil): 1985–89 está dentro do período de cheia dos anos 1980, o que infla a queda; a frase diz isso. Só Corumbá tem o -61% exato.

## 10. Tietê: 41 m³/s de esgoto, 56% da vazão
- Cálculo: trecho 64904 (23,51°S 46,84°O, Barueri), vazão 72,2 m³/s, `esg` = 56,4% = 40,7 m³/s de lançamento classificado como esgoto, acumulado a montante.
- Conferência: (a) `br_ana_outorgas.lancamentos`, retângulo da bacia (46,93 a 45,65°O; 23,96 a 23,37°S), `tfn_ds = 'Esgotamento Sanitário'`: 43,3 m³/s brutos; (b) Atlas Esgotos, 15 municípios da região metropolitana: 31,7 m³/s de esgoto gerado, 27,6 coletado (retrato de 2013). 31,7 < 40,7 < 43,3.
- Cuidado: a vazão do mapa é natural e ignora a água importada do Cantareira; a proporção real do canal é menor. O bruto de 43,3 inclui transferências de Mogi entre represas, que o `poluicao.py` filtra em parte. Por isso a frase diz "vazão natural" e "esgoto licenciado".

## 11. Acre: 78 de cada 100 litros
- SQL: `br_mdr_snis.municipio_agua_esgoto`, 2022, `indice_perda_distribuicao_agua BETWEEN 0 AND 100`, mediana por UF: AC 77,8 (22 municípios), SP 23,9 (643).
- Conferência (recálculo pelos volumes: (produzido + importado - consumido - serviço) / (produzido + importado - serviço)): AC 66,6% agregado, SP 33,8% agregado; mediana filtrada AC 77,8, SP 23,0. A ordem entre os estados e a magnitude se mantêm; o texto diz "município típico" porque 78 é mediana, não agregado.
- Cuidado: SP 23,9 ou 23,0 conforme o filtro, daí "cerca de 24".

## 12. Síntese
- 462.539 trechos (banco: `br_ana_bho.topologia`, 462.539 linhas únicas). 2.558 trechos com licença ≥ 100% da vazão, fora do Brasil incluído (2.544 dentro): reproduzido por decodificação do `out` (≥1,0) e igual ao README.

## Descartados e por quê
- Cheia que mudou de mês: nos rios do Paraná (Ivaí, Piquiri) o pico passa de maio para outubro (Ivaí: 648 m³/s em maio, 709 em outubro), mas o regime é quase plano (máx/mín < 2), a janela "antes" tem só 17 anos em Porto Bananeira e o Iguaçu é regulado. Reproduz a conta, mas não é sólido.
- Estação centenária: a série mais longa é Corrientes (Argentina, desde 1901). Entre as brasileiras, a continuidade de séries de 100 anos não passou em nenhuma segunda via de forma interessante para o mapa.
- Juqueri (273% de licença): 33 m³/s são "Outras", ou seja, a transposição do Cantareira. Não é água do rio.
- Rio Preto (GO/DF) e Rio das Balsas (MA), licença ~101%, mais de 90% irrigação: verificado, mas fica atrás do Piranhas-Açu. Boa reserva.
- Jaguari (-29,6%/década) e Apodi-Mossoró (-30,2%): há reservatório a montante e a atribuição à seca é ambígua.
- "530 mil dias secos em 609 estações" do README: só 479 das 609 têm algum dia seco; o total de 529.954 dias bate. Se for usado, trocar o 609.
- Mediana nacional de perda (29,9%): reproduzi 29,7% com filtro de volume > 0; não vale citar com duas casas. A cena usa o Acre e SP.
