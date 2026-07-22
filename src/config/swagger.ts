import swaggerJSDoc, { type Options } from 'swagger-jsdoc'

const options: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ReadHub API',
      version: '1.0.0',
      description: 'API documentation for ReadHub backend',
    },
    servers: [
      {
        url: process.env.SWAGGER_SERVER_URL || 'http://localhost:5000',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      {
        name: 'Auth',
        description: 'Authentication related endpoints',
      },
      {
        name: 'User',
        description: 'Endpoints for user profile management',
      },
      {
        name: 'Books',
        description: 'Endpoints for book management',
      },
      {
        name: 'Notes',
        description: 'Endpoints for note management',
      },
    ],
    security: [{ bearerAuth: [] }],
  },
  // Parsed as source text, so this works for both the TS sources (dev) and the
  // compiled JS (prod) — tsc keeps comments by default. Non-existent globs are ignored.
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
}

const swaggerSpec = swaggerJSDoc(options)

export default swaggerSpec
