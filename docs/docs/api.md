# API (OpenAPI)

Referencia **en vivo** de todos los endpoints, generada por `@nestjs/swagger` a partir de los
decoradores de cada controller y DTO del backend (`/api-json`).

!!! note "Solo en desarrollo"
    El backend sirve la especificación OpenAPI únicamente cuando `NODE_ENV !== 'production'`.
    Este portal la consume desde `http://localhost:3050/api-json` (el puerto del backend en el
    stack de desarrollo). En producción la referencia no se expone públicamente.

<swagger-ui src="http://localhost:3050/api-json"/>
