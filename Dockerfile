# Usar imagem base com Chrome pré-instalado
FROM ghcr.io/puppeteer/puppeteer:21.0.0

# Mudar para root para instalações
USER root

# Instalar dependências adicionais e fontes
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Diretório da aplicação
WORKDIR /app

# Criar diretório para screenshots
RUN mkdir -p /app/screenshots && chmod 777 /app/screenshots

# Copiar package.json primeiro (cache de camadas)
COPY package*.json ./

# Instalar dependências sem baixar Chromium novamente
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Instalar dependências do Node
RUN npm ci --only=production && npm cache clean --force

# Copiar código da aplicação
COPY server.js .

# Criar usuário não-root e dar permissões
RUN chown -R pptruser:pptruser /app

# Mudar para usuário não-root
USER pptruser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Porta
EXPOSE 3001

# Comando para iniciar
CMD ["node", "server.js"]
