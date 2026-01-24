@cart @travel
Feature: Itinerary Management
  As a traveler
  I want to manage my flight selections
  So that I can customize my journey

  Background:
    Given I have selected a flight

  @critical @TC_713275
  Scenario: Select Flight Option (Economy/Business)
    Given I am reviewing my flight selection
    When I choose "Business Class" upgrade
    And I click "Update Itinerary"
    Then the itinerary should reflect "Business Class"
    And the total price should serve me right

  @TC_269259
  Scenario: Add Extra Baggage
    Given I am on the itinerary page
    When I add "2" extra checked bags
    Then the additional baggage fee should be added to the total
    And the baggage allowance should be updated

  @negative @TC_354929
  Scenario: Remove Flight from Itinerary
    Given I have the following flights in my itinerary:
      | flight | origin | dest |
      | BA117  | LHR    | JFK  |
      | AA100  | JFK    | LHR  |
    When I remove "AA100" from the itinerary
    Then "AA100" should no longer be visible
    But "BA117" should remain in the itinerary
