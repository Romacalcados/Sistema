/* navegacao.js
   Menu padrão do Calçados Roma.
   Para usar em qualquer página:
   1) Coloque este arquivo na mesma pasta dos HTMLs.
   2) Adicione antes do <script type="module"> da página:
      <script src="navegacao.js"></script>
   3) Depois de buscar o usuário no Firebase, chame:
      window.SistemaNavegacao.init({ userLevel, userName, onLogout });
*/
(function () {
  'use strict';

  const NIVEL_NOMES = {
    "01": "Cadastro",
    "02": "Corte",
    "03": "Costura",
    "04": "Sola",
    "05": "Palmilha",
    "06": "Montagem",
    "07": "Programação",
    "08": "Financeiro",
    "09": "Admin"
};

  const PAGINAS = [
  {
    "group": "Início",
    "name": "Início",
    "href": "index.html",
    "levels": [
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Cadastro",
    "name": "Cadastro de Usuários",
    "href": "cadastroUsuarios.html",
    "levels": [
      "09"
    ]
  },
  {
    "group": "Cadastro",
    "name": "Cadastro de Talões",
    "href": "cadastroTaloes.html",
    "levels": [
      "01",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Cadastro",
    "name": "Cadastro Manual",
    "href": "cadastromanual.html",
    "levels": [
      "01",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Cadastro",
    "name": "Edição de Talões",
    "href": "relatoriogeral.html",
    "levels": [
      "01",
      "09"
    ]
  },
  {
    "group": "Cadastro",
    "name": "Modelos",
    "href": "modelos.html",
    "levels": [
      "08",
      "09"
    ]
  },
  {
    "group": "Planejamento",
    "name": "Criar Distribuição",
    "href": "distribuicao_montagem.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Planejamento",
    "name": "Distribuição de Ateliês",
    "href": "distribuicaoatt.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Planejamento",
    "name": "Criar Programação",
    "href": "programacao_montagem.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Ferramentas",
    "name": "Romaneio",
    "href": "romaneio.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Ferramentas",
    "name": "Movimentações",
    "href": "movimentacao.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Ferramentas",
    "name": "Fechamento de Remessas",
    "href": "encerramento.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Corte",
    "name": "Corte",
    "href": "corte.html",
    "levels": [
      "02",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Corte",
    "name": "Talões Perdidos",
    "href": "taloesperdidos.html",
    "levels": [
      "02",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Corte",
    "name": "Programação de Corte",
    "href": "programacaocrt.html",
    "levels": [
      "02",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Relatórios",
    "name": "Cronograma",
    "href": "cronograma.html",
    "levels": [
      "01",
      "02",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Relatórios",
    "name": "Cronograma Celular",
    "href": "cronograma_mobile.html",
    "levels": [
      "01",
      "02",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Relatórios",
    "name": "Giro de Produção",
    "href": "giro_geral.html",
    "levels": [
      "01",
      "02",
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Relatórios",
    "name": "Controle de Produção",
    "href": "controle.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Relatórios",
    "name": "Controle Celular",
    "href": "controle_mobile.html",
    "levels": [
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Financeiro",
    "name": "Faturamento",
    "href": "faturamento_fina.html",
    "levels": [
      "08",
      "09"
    ]
  },
  {
    "group": "Financeiro",
    "name": "Faturamento de Ateliês",
    "href": "faturamentoatt.html",
    "levels": [
      "08",
      "09"
    ]
  },
  {
    "group": "Costura",
    "name": "Relatório Ateliê",
    "href": "relatorioAtelier.html",
    "levels": [
      "03",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Costura",
    "name": "Controle",
    "href": "programacaoatt.html",
    "levels": [
      "03",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Costura",
    "name": "Programação",
    "href": "programacao_atelier.html",
    "levels": [
      "03",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Costura",
    "name": "Entrada Ateliê",
    "href": "costura_entrada.html",
    "levels": [
      "03",
      "09"
    ]
  },
  {
    "group": "Costura",
    "name": "Saída Ateliê",
    "href": "costura_saida.html",
    "levels": [
      "03",
      "09"
    ]
  },
  {
    "group": "Palmilha",
    "name": "Relatório Ateliê",
    "href": "palmilha_relatorio.html",
    "levels": [
      "05",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Palmilha",
    "name": "Controle",
    "href": "palmilha_controle.html",
    "levels": [
      "05",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Palmilha",
    "name": "Programação",
    "href": "palmilha_programacao.html",
    "levels": [
      "05",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Palmilha",
    "name": "Entrada Ateliê",
    "href": "palmilha_entrada.html",
    "levels": [
      "05",
      "09"
    ]
  },
  {
    "group": "Palmilha",
    "name": "Saída Ateliê",
    "href": "palmilha_saida.html",
    "levels": [
      "05",
      "09"
    ]
  },
  {
    "group": "Sola",
    "name": "Relatório Ateliê",
    "href": "sola_relatorio.html",
    "levels": [
      "04",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Sola",
    "name": "Controle",
    "href": "sola_controle.html",
    "levels": [
      "04",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Sola",
    "name": "Programação",
    "href": "sola_programacao.html",
    "levels": [
      "04",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Sola",
    "name": "Entrada Ateliê",
    "href": "sola_entrada.html",
    "levels": [
      "04",
      "09"
    ]
  },
  {
    "group": "Sola",
    "name": "Saída Ateliê",
    "href": "sola_saida.html",
    "levels": [
      "04",
      "09"
    ]
  },
  {
    "group": "Fábrica",
    "name": "Distribuição",
    "href": "distribuicao.html",
    "levels": [
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Fábrica",
    "name": "Talonagem",
    "href": "talonagem.html",
    "levels": [
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Fábrica",
    "name": "Montagem",
    "href": "montagem.html",
    "levels": [
      "06",
      "07",
      "08",
      "09"
    ]
  },
  {
    "group": "Administração",
    "name": "Preparação da Roma",
    "href": "configuracao_roma.html",
    "levels": [
      "09"
    ]
  },
  {
    "group": "Backup",
    "name": "Backup",
    "href": "migracaotaloes.html",
    "levels": [
      "09"
    ]
  },
  {
    "group": "Backup",
    "name": "Cronograma Antigo",
    "href": "cronogramaBackup.html",
    "levels": [
      "09"
    ]
  }
];

  function normalizarHref(valor) {
    return String(valor || '')
      .split('?')[0]
      .split('#')[0]
      .split('/')
      .pop()
      .toLowerCase();
  }

  function paginaAtual() {
    const atual = normalizarHref(window.location.pathname);
    return atual || 'index.html';
  }

  function paginasPermitidas(userLevel) {
    return PAGINAS.filter((pagina) => pagina.levels.includes(String(userLevel)));
  }

  function podeAcessar(userLevel, href) {
    const arquivo = normalizarHref(href || paginaAtual());
    const pagina = PAGINAS.find((item) => normalizarHref(item.href) === arquivo);

    // Toda página operacional precisa estar declarada na matriz de acesso.
    if (!pagina) return false;

    return pagina.levels.includes(String(userLevel));
  }

  function injetarEstilos() {
    if (document.getElementById('sistema-navegacao-style')) return;

    const style = document.createElement('style');
    style.id = 'sistema-navegacao-style';
    style.textContent = `
      :root {
        --nav-bg: #2f343a;
        --nav-bg-2: #424a53;
        --nav-bg-3: #59626d;
        --nav-text: #ffffff;
        --nav-muted: #cfd6df;
        --nav-border: rgba(255,255,255,.10);
        --nav-shadow: 0 10px 30px rgba(0,0,0,.28);
        --nav-red: #e6272f;
        --nav-red-hover: #c91f27;
      }

      body {
        margin: 0;
        padding-top: 54px;
      }

      .sistema-topbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2000;
        height: 54px;
        background: var(--nav-bg);
        color: var(--nav-text);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        box-sizing: border-box;
        box-shadow: 0 2px 8px rgba(0,0,0,.18);
      }

      .sistema-topbar-left,
      .sistema-topbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .sistema-title {
        margin: 0;
        font-size: 23px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: -.4px;
        white-space: nowrap;
      }

      .sistema-menu-btn,
      .sistema-logout-btn,
      .sistema-menu-close {
        border: 0;
        cursor: pointer;
        font-weight: 700;
        transition: background .2s ease, transform .1s ease;
      }

      .sistema-menu-btn {
        background: #f1f3f6;
        color: #111827;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 14px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .sistema-menu-btn:hover {
        background: #e2e6eb;
      }

      .sistema-menu-btn:active,
      .sistema-logout-btn:active,
      .sistema-menu-close:active {
        transform: scale(.98);
      }

      .sistema-user-box {
        text-align: right;
        line-height: 1.15;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
      }

      .sistema-user-box small {
        display: block;
        color: var(--nav-text);
        font-size: 13px;
        font-weight: 700;
      }

      .sistema-logout-btn {
        background: var(--nav-red);
        color: #fff;
        border-radius: 8px;
        padding: 9px 13px;
        font-size: 14px;
      }

      .sistema-logout-btn:hover {
        background: var(--nav-red-hover);
      }

      .sistema-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 2100;
        background: rgba(0,0,0,.35);
        opacity: 0;
        visibility: hidden;
        transition: opacity .22s ease, visibility .22s ease;
      }

      .sistema-menu-drawer {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2200;
        width: min(320px, 88vw);
        height: 100vh;
        background: var(--nav-bg-2);
        color: var(--nav-text);
        box-shadow: var(--nav-shadow);
        transform: translateX(-102%);
        transition: transform .25s ease;
        display: flex;
        flex-direction: column;
      }

      body.sistema-menu-aberto .sistema-menu-overlay {
        opacity: 1;
        visibility: visible;
      }

      body.sistema-menu-aberto .sistema-menu-drawer {
        transform: translateX(0);
      }

      .sistema-menu-head {
        height: 54px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        border-bottom: 1px solid var(--nav-border);
        box-sizing: border-box;
      }

      .sistema-menu-head h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
      }

      .sistema-menu-close {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: var(--nav-bg-3);
        color: #fff;
        font-size: 18px;
      }

      .sistema-menu-lista {
        padding: 8px 8px 16px;
        overflow-y: auto;
      }

      .sistema-menu-grupo {
        padding: 12px 10px 5px;
        color: var(--nav-muted);
        font-size: 10.5px;
        font-weight: 800;
        letter-spacing: .09em;
        text-transform: uppercase;
        border-top: 1px solid rgba(255,255,255,.07);
        margin-top: 6px;
      }

      .sistema-menu-grupo:first-child {
        border-top: 0;
        margin-top: 0;
      }

      .sistema-menu-link {
        display: flex;
        align-items: center;
        min-height: 34px;
        padding: 0 12px 0 20px;
        border-radius: 8px;
        color: #f4f7fb;
        text-decoration: none;
        font-size: 13px;
        font-weight: 500;
        margin: 1px 0;
        position: relative;
      }

      .sistema-menu-link::before {
        content: '';
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(255,255,255,.38);
        position: absolute;
        left: 10px;
      }

      .sistema-menu-link:hover {
        background: rgba(255,255,255,.09);
      }

      .sistema-menu-link.ativo {
        background: rgba(255,255,255,.14);
        font-weight: 650;
      }

      .sistema-menu-vazio {
        padding: 14px;
        color: var(--nav-muted);
        font-weight: 600;
        font-size: 13px;
      }

      @media (max-width: 760px) {
        body {
          padding-top: 50px;
        }

        .sistema-topbar {
          height: 50px;
          padding: 0 8px;
        }

        .sistema-title {
          font-size: 18px;
        }

        .sistema-menu-btn {
          padding: 7px 10px;
          font-size: 13px;
        }

        .sistema-user-box {
          display: none;
        }

        .sistema-logout-btn {
          padding: 8px 11px;
          font-size: 13px;
        }

        .sistema-menu-head {
          height: 50px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function criarTopbar({ userName, userLevel, title, onLogout }) {
    const topbarAntiga = document.querySelector('.sistema-topbar');
    const overlayAntigo = document.querySelector('.sistema-menu-overlay');
    const drawerAntigo = document.querySelector('.sistema-menu-drawer');

    if (topbarAntiga) topbarAntiga.remove();
    if (overlayAntigo) overlayAntigo.remove();
    if (drawerAntigo) drawerAntigo.remove();

    const topbar = document.createElement('header');
    topbar.className = 'sistema-topbar';
    topbar.setAttribute('data-sistema-navegacao', 'topbar');

    const nivelTexto = NIVEL_NOMES[String(userLevel)] || `Nível ${userLevel || ''}`.trim();
    const nomeTexto = userName || 'Usuário';

    topbar.innerHTML = `
      <div class="sistema-topbar-left">
        <button class="sistema-menu-btn" type="button" aria-controls="sistemaMenuDrawer" aria-expanded="false">
          <span aria-hidden="true">☰</span> Menu
        </button>
        <h1 class="sistema-title">${escapeHtml(title || 'Calçados Roma')}</h1>
      </div>
      <div class="sistema-topbar-right">
        <div class="sistema-user-box">
          <span>Olá, ${escapeHtml(nomeTexto)}!</span>
          <small>Setor: ${escapeHtml(nivelTexto)}</small>
        </div>
        <button class="sistema-logout-btn" type="button">Sair</button>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'sistema-menu-overlay';
    overlay.setAttribute('data-sistema-navegacao', 'overlay');

    const drawer = document.createElement('aside');
    drawer.id = 'sistemaMenuDrawer';
    drawer.className = 'sistema-menu-drawer';
    drawer.setAttribute('data-sistema-navegacao', 'drawer');
    drawer.setAttribute('aria-hidden', 'true');

    drawer.innerHTML = `
      <div class="sistema-menu-head">
        <h2>Menu</h2>
        <button class="sistema-menu-close" type="button" aria-label="Fechar menu">×</button>
      </div>
      <nav class="sistema-menu-lista" aria-label="Menu principal"></nav>
    `;

    document.body.prepend(drawer);
    document.body.prepend(overlay);
    document.body.prepend(topbar);

    const botaoMenu = topbar.querySelector('.sistema-menu-btn');
    const botaoSair = topbar.querySelector('.sistema-logout-btn');
    const botaoFechar = drawer.querySelector('.sistema-menu-close');

    function abrirMenu() {
      document.body.classList.add('sistema-menu-aberto');
      botaoMenu.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
    }

    function fecharMenu() {
      document.body.classList.remove('sistema-menu-aberto');
      botaoMenu.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
    }

    botaoMenu.addEventListener('click', abrirMenu);
    botaoFechar.addEventListener('click', fecharMenu);
    overlay.addEventListener('click', fecharMenu);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') fecharMenu();
    });

    botaoSair.addEventListener('click', async () => {
      if (typeof onLogout === 'function') {
        await onLogout();
      }
    });

    return { topbar, drawer, fecharMenu };
  }

  function montarMenu(drawer, userLevel, fecharMenu) {
    const nav = drawer.querySelector('.sistema-menu-lista');
    nav.innerHTML = '';

    const permitidas = paginasPermitidas(String(userLevel));
    const atual = paginaAtual();
    let grupoAtual = '';

    if (!permitidas.length) {
      nav.innerHTML = '<div class="sistema-menu-vazio">Nenhuma página liberada para este usuário.</div>';
      return;
    }

    permitidas.forEach((pagina) => {
      if (pagina.group !== grupoAtual) {
        grupoAtual = pagina.group;
        const tituloGrupo = document.createElement('div');
        tituloGrupo.className = 'sistema-menu-grupo';
        tituloGrupo.textContent = grupoAtual;
        nav.appendChild(tituloGrupo);
      }

      const link = document.createElement('a');
      link.className = 'sistema-menu-link';
      link.href = pagina.href;
      link.textContent = pagina.name;

      if (normalizarHref(pagina.href) === atual) {
        link.classList.add('ativo');
      }

      link.addEventListener('click', fecharMenu);
      nav.appendChild(link);
    });
  }

  function escapeHtml(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function init(options = {}) {
    const userLevel = String(options.userLevel || localStorage.getItem('calcadosroma-65ac6:userNivelAcesso') || '');
    const userName = options.userName || localStorage.getItem('calcadosroma-65ac6:userName') || 'Usuário';
    const title = options.title || 'Calçados Roma';

    injetarEstilos();

    if (!podeAcessar(userLevel, paginaAtual())) {
      alert('Você não tem permissão para acessar esta página.');
      window.location.href = 'index.html';
      return;
    }

    const { drawer, fecharMenu } = criarTopbar({
      userName,
      userLevel,
      title,
      onLogout: options.onLogout
    });

    montarMenu(drawer, userLevel, fecharMenu);
  }

  window.SistemaNavegacao = {
    init,
    pages: PAGINAS,
    nivelNomes: NIVEL_NOMES,
    podeAcessar,
    paginasPermitidas
  };
})();
