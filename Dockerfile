FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 alder && chown -R alder:nodejs /app
USER alder
ENV NODE_ENV=production
ENV PORT=4000
ENV FRONTEND_ORIGIN=https://alderhost-frontend-0v4eyf-977fd9-169-58-206-96.sslip.io
EXPOSE 4000
CMD ["node", "src/index.js"]
