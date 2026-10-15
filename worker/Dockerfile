FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY product-content.js ./
COPY product-options.js ./
COPY option-sources.js option-collector.js ./
USER pwuser
EXPOSE 3000
CMD ["npm", "start"]
