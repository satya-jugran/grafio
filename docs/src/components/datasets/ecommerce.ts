import { Dataset } from './types';

export const ecommerceDataset: Dataset = {
  id: 'ecommerce',
  name: 'E-Commerce Platform',
  description: 'An e-commerce system featuring users, products, categories, purchases, and reviews.',
  data: {
      "nodes": [
            {
                  "id": "u1",
                  "labels": [
                        "User"
                  ],
                  "properties": {
                        "username": "shopper99",
                        "premium": true
                  }
            },
            {
                  "id": "u2",
                  "labels": [
                        "User"
                  ],
                  "properties": {
                        "username": "gadgetgeek",
                        "premium": false
                  }
            },
            {
                  "id": "cat1",
                  "labels": [
                        "Category"
                  ],
                  "properties": {
                        "name": "Electronics"
                  }
            },
            {
                  "id": "cat2",
                  "labels": [
                        "Category"
                  ],
                  "properties": {
                        "name": "Accessories"
                  }
            },
            {
                  "id": "prod1",
                  "labels": [
                        "Product"
                  ],
                  "properties": {
                        "name": "Smartphone X",
                        "price": 999.99
                  }
            },
            {
                  "id": "prod2",
                  "labels": [
                        "Product"
                  ],
                  "properties": {
                        "name": "Wireless Earbuds",
                        "price": 149.99
                  }
            },
            {
                  "id": "prod3",
                  "labels": [
                        "Product"
                  ],
                  "properties": {
                        "name": "Phone Case",
                        "price": 19.99
                  }
            },
            {
                  "id": "rev1",
                  "labels": [
                        "Review"
                  ],
                  "properties": {
                        "rating": 5,
                        "comment": "Amazing phone!"
                  }
            },
            {
                  "id": "rev2",
                  "labels": [
                        "Review"
                  ],
                  "properties": {
                        "rating": 3,
                        "comment": "Battery life is okay."
                  }
            }
      ],
      "edges": [
            {
                  "id": "ee1",
                  "sourceId": "prod1",
                  "targetId": "cat1",
                  "type": "BELONGS_TO",
                  "properties": {}
            },
            {
                  "id": "ee2",
                  "sourceId": "prod2",
                  "targetId": "cat1",
                  "type": "BELONGS_TO",
                  "properties": {}
            },
            {
                  "id": "ee3",
                  "sourceId": "prod3",
                  "targetId": "cat2",
                  "type": "BELONGS_TO",
                  "properties": {}
            },
            {
                  "id": "ee4",
                  "sourceId": "u1",
                  "targetId": "prod1",
                  "type": "PURCHASED",
                  "properties": {
                        "date": "2024-01-10"
                  }
            },
            {
                  "id": "ee5",
                  "sourceId": "u1",
                  "targetId": "prod3",
                  "type": "PURCHASED",
                  "properties": {
                        "date": "2024-01-10"
                  }
            },
            {
                  "id": "ee6",
                  "sourceId": "u2",
                  "targetId": "prod2",
                  "type": "VIEWED",
                  "properties": {
                        "times": 5
                  }
            },
            {
                  "id": "ee7",
                  "sourceId": "u1",
                  "targetId": "rev1",
                  "type": "WROTE_REVIEW",
                  "properties": {}
            },
            {
                  "id": "ee8",
                  "sourceId": "rev1",
                  "targetId": "prod1",
                  "type": "REVIEW_OF",
                  "properties": {}
            },
            {
                  "id": "ee9",
                  "sourceId": "u2",
                  "targetId": "rev2",
                  "type": "WROTE_REVIEW",
                  "properties": {}
            },
            {
                  "id": "ee10",
                  "sourceId": "rev2",
                  "targetId": "prod2",
                  "type": "REVIEW_OF",
                  "properties": {}
            },
            {
                  "id": "ee11",
                  "sourceId": "u2",
                  "targetId": "u1",
                  "type": "FOLLOWS",
                  "properties": {}
            }
      ]
}
};
