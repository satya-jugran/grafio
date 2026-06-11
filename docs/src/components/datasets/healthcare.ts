import { Dataset } from './types';

export const healthcareDataset: Dataset = {
  id: 'healthcare',
  name: 'Healthcare Records',
  description: 'A healthcare network with patients, doctors, hospitals, conditions, and medications.',
  data: {
      "nodes": [
            {
                  "id": "pat1",
                  "labels": [
                        "Patient"
                  ],
                  "properties": {
                        "name": "John Smith",
                        "age": 45,
                        "bloodType": "O+"
                  }
            },
            {
                  "id": "pat2",
                  "labels": [
                        "Patient"
                  ],
                  "properties": {
                        "name": "Mary Johnson",
                        "age": 32,
                        "bloodType": "A-"
                  }
            },
            {
                  "id": "doc1",
                  "labels": [
                        "Doctor"
                  ],
                  "properties": {
                        "name": "Dr. Gregory House",
                        "specialty": "Diagnostician"
                  }
            },
            {
                  "id": "doc2",
                  "labels": [
                        "Doctor"
                  ],
                  "properties": {
                        "name": "Dr. Allison Cameron",
                        "specialty": "Immunologist"
                  }
            },
            {
                  "id": "hosp1",
                  "labels": [
                        "Hospital"
                  ],
                  "properties": {
                        "name": "Princeton-Plainsboro",
                        "location": "New Jersey"
                  }
            },
            {
                  "id": "med1",
                  "labels": [
                        "Medication"
                  ],
                  "properties": {
                        "name": "Vicodin",
                        "dosage": "5mg"
                  }
            },
            {
                  "id": "med2",
                  "labels": [
                        "Medication"
                  ],
                  "properties": {
                        "name": "Amoxicillin",
                        "dosage": "500mg"
                  }
            },
            {
                  "id": "cond1",
                  "labels": [
                        "Condition"
                  ],
                  "properties": {
                        "name": "Lupus",
                        "severity": "High"
                  }
            }
      ],
      "edges": [
            {
                  "id": "he1",
                  "sourceId": "pat1",
                  "targetId": "doc1",
                  "type": "TREATED_BY",
                  "properties": {
                        "since": "2022"
                  }
            },
            {
                  "id": "he2",
                  "sourceId": "pat2",
                  "targetId": "doc2",
                  "type": "TREATED_BY",
                  "properties": {
                        "since": "2023"
                  }
            },
            {
                  "id": "he3",
                  "sourceId": "doc1",
                  "targetId": "hosp1",
                  "type": "WORKS_AT",
                  "properties": {}
            },
            {
                  "id": "he4",
                  "sourceId": "doc2",
                  "targetId": "hosp1",
                  "type": "WORKS_AT",
                  "properties": {}
            },
            {
                  "id": "he5",
                  "sourceId": "doc1",
                  "targetId": "med1",
                  "type": "PRESCRIBED",
                  "properties": {
                        "date": "2023-10-12"
                  }
            },
            {
                  "id": "he6",
                  "sourceId": "pat1",
                  "targetId": "med1",
                  "type": "TAKES",
                  "properties": {
                        "frequency": "Daily"
                  }
            },
            {
                  "id": "he7",
                  "sourceId": "pat1",
                  "targetId": "cond1",
                  "type": "DIAGNOSED_WITH",
                  "properties": {
                        "date": "2022-05-10"
                  }
            }
      ]
}
};
