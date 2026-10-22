/* Aviso para funções que dependem de um segundo projeto da empresa. */
(function () {
  'use strict';
  window.mostrarBackupNaoConfigurado = function (titulo) {
    const panel = document.createElement('main');
    panel.style.cssText = 'max-width:720px;margin:56px auto;padding:28px;background:#fff;border:1px solid #ddd;border-radius:12px;font:16px/1.6 Arial,sans-serif;color:#222';
    const heading = document.createElement('h1');
    heading.textContent = titulo;
    const message = document.createElement('p');
    message.textContent = 'O banco de arquivo da Calçados Roma ainda não foi configurado. Esta função estará disponível quando houver um projeto de backup próprio da empresa e acesso autorizado a ele.';
    const detail = document.createElement('p');
    detail.textContent = 'O sistema principal da Roma pode ser utilizado normalmente. Para continuar, volte ao painel.';
    const link = document.createElement('a');
    link.href = 'index.html';
    link.textContent = 'Voltar ao painel';
    link.style.cssText = 'display:inline-block;padding:10px 16px;background:#333;color:#fff;border-radius:6px;text-decoration:none';
    panel.append(heading, message, detail, link);
    document.body.style.cssText = 'background:#f4f4f4;margin:0;padding:16px';
    document.body.replaceChildren(panel);
  };
})();
