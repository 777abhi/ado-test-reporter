@catalog @travel
Feature: Flight Search and Selection
  As a traveler
  I want to search for available flights
  So that I can plan my trip

  Background:
    Given the flight inventory is updated

  @smoke @TC_837
  Scenario: Search for Flights (Origin/Destination)
    Given I am on the flight search page
    When I search for flights from "LHR" to "JFK"
    Then I should see a list of available flights
    And the results should show flight duration and price

  @TC_838
  Scenario: Filter Flights by Airline
    Given I have searched for flights
    When I apply the filter "Airline: British Airways"
    Then the results should only show flights operated by "British Airways"

  @TC_839
  Scenario Outline: View Flight Details
    Given I am viewing the search results for "<flight>"
    When I click on the flight "<flight>"
    Then I should see the flight details page
    And the baggage allowance should be visible
    And the "Select this Flight" button should be enabled

    Examples:
      | flight |
      | BA117  |
      | AA100  |
